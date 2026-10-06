const speech = require('@google-cloud/speech');

const VALID_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);

/** Own one lazily started recognizer per connected participant. */
class SpeechToTextService {
  constructor({ client, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now,
    languageCode = 'en-US', maxStreams = 20, maxSessionMs = 0, idleMs = 0,
    telemetry = { record() {}, failure() {} } } = {}) {
    if (![maxSessionMs, idleMs].every(value => Number.isInteger(value) && value >= 0 && value <= 2147483647)) {
      throw new Error('Caption time limits must be non-negative integer milliseconds.');
    }
    this.telemetry = telemetry;
    this.client = client;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.languageCode = languageCode;
    this.maxStreams = maxStreams;
    this.maxSessionMs = maxSessionMs;
    this.idleMs = idleMs;
    this.recognizeStreams = new Map();
    this.STREAM_TIMEOUT = 4.5 * 60 * 1000;
    this.MAX_FAILURE_MS = 5 * 60 * 1000;
  }

  /** Register a participant without opening a billable cloud stream. */
  bindSocketToStream(socketId, socket, onTranscript, onStatus) {
    const previous = this.recognizeStreams.get(socketId);
    if (previous) {
      previous.socket = socket;
      previous.onTranscript = onTranscript;
      previous.onStatus = onStatus;
      return;
    }
    this.recognizeStreams.set(socketId, {
      socket, onTranscript, onStatus, stream: null, restartTimer: null, retryTimer: null,
      languageCode: this.languageCode, sampleRateHertz: 16000, status: 'ready',
      retryDelay: 1000, failureStartedAt: null, unavailable: false,
      droppedAt: null, budget: null,
      streamStartedAt: null, audioMs: 0, finalEndMs: 0, audioHistory: [],
      firstStreamAt: null, sessionTimer: null, idleTimer: null, idleDeadline: null,
    });
  }

  /** Replace a cloud stream while preserving the participant and retry state. */
  createRecognizeStream(socketId, languageCode, sampleRateHertz) {
    const info = this.recognizeStreams.get(socketId);
    if (!info || !info.socket.connected || info.unavailable) return null;
    if (this._sessionExpired(socketId, info)) return null;
    if (languageCode) info.languageCode = languageCode;
    if (sampleRateHertz && sampleRateHertz !== info.sampleRateHertz) {
      info.audioHistory = [];
      info.finalEndMs = info.audioMs;
    }
    if (sampleRateHertz) info.sampleRateHertz = sampleRateHertz;
    this._stopStream(info);
    if ([...this.recognizeStreams.values()].filter(entry => entry.stream).length >= this.maxStreams) {
      info.unavailable = true;
      this.telemetry.record('speech_unavailable');
      this._status(socketId, info, { status: 'unavailable', reason: 'capacity', retryable: true });
      return null;
    }

    let stream;
    try {
      this.client ||= new speech.SpeechClient();
      stream = this.client.streamingRecognize({
        config: {
          encoding: 'LINEAR16', sampleRateHertz: info.sampleRateHertz,
          languageCode: info.languageCode, model: 'latest_long',
          enableAutomaticPunctuation: true,
        },
        interimResults: true,
        singleUtterance: false,
      });
    } catch (error) {
      this._retry(socketId, info, error);
      return null;
    }
    const replay = this._replay(info);
    const streamBaseMs = replay.length ? replay[0].startMs : info.audioMs;
    info.stream = stream;
    this.telemetry.record('speech_started');
    info.streamStartedAt = this.now();
    this._armLimits(socketId, info);
    this._status(socketId, info, { status: 'starting' });
    info.restartTimer = this.setTimer(() => {
      if (this.recognizeStreams.get(socketId) === info) {
        this.telemetry.record('speech_rotated');
        this.createRecognizeStream(socketId);
      }
    }, this.STREAM_TIMEOUT);

    stream.on('data', (data) => {
      if (info.stream !== stream || this.recognizeStreams.get(socketId) !== info) return;
      info.failureStartedAt = null;
      info.retryDelay = 1000;
      if (info.status !== 'active') this._status(socketId, info, { status: 'active' });
      for (const result of data.results || []) {
        const alternative = result.alternatives?.[0];
        if (!alternative?.transcript) continue;
        const end = result.resultEndTime;
        const seconds = Number(end?.seconds ?? 0);
        const nanos = Number(end?.nanos ?? 0);
        const relativeMs = seconds * 1000 + nanos / 1e6;
        const endMs = end && Number.isFinite(relativeMs) && relativeMs >= 0
          ? Math.min(info.audioMs, streamBaseMs + relativeMs) : null;
        if (endMs !== null && endMs <= info.finalEndMs) continue;
        if (result.isFinal) info.finalEndMs = endMs ?? info.audioMs;
        const transcript = {
          transcript: alternative.transcript, isFinal: Boolean(result.isFinal),
          stability: result.stability, confidence: alternative.confidence, isLocal: true,
        };
        info.socket.emit('transcript', transcript);
        if (info.onTranscript) info.onTranscript(transcript);
      }
    });
    stream.on('error', (error) => {
      if (info.stream === stream) this._retry(socketId, info, error);
    });
    stream.on('end', () => {
      if (info.stream === stream) this._retry(socketId, info, new Error('Speech stream ended'));
    });
    for (const entry of replay) {
      if (info.stream !== stream || !stream.writable || stream.writableNeedDrain) { this._dropped(socketId, info); break; }
      try { stream.write(entry.buffer); this.telemetry.record('speech_replayed'); }
      catch (error) { this._retry(socketId, info, error); break; }
    }
    return info.stream;
  }

  _replay(info) {
    const cutoff = Math.max(info.finalEndMs, info.audioMs - 5000);
    return info.audioHistory.filter(entry => entry.endMs > cutoff).map(entry => {
      const samples = Math.max(0, Math.ceil((cutoff - entry.startMs) * info.sampleRateHertz / 1000));
      return { ...entry, buffer: entry.buffer.subarray(samples * 2),
        startMs: entry.startMs + samples / info.sampleRateHertz * 1000 };
    }).filter(entry => entry.buffer.length);
  }

  _sessionExpired(socketId, info) {
    if (!this.maxSessionMs || info.firstStreamAt === null || this.now() < info.firstStreamAt + this.maxSessionMs) return false;
    this._limit(socketId, info, 'session_limit');
    return true;
  }

  _armLimits(socketId, info) {
    if (info.firstStreamAt === null) {
      info.firstStreamAt = this.now();
      if (this.maxSessionMs) info.sessionTimer = this.setTimer(() => {
        if (this.recognizeStreams.get(socketId) === info) this._limit(socketId, info, 'session_limit');
      }, this.maxSessionMs);
    }
    // Stream rotation and provider retries preserve the original session deadline.
    if (info.idleTimer === null) this._armIdle(socketId, info);
  }

  _armIdle(socketId, info) {
    if (!this.idleMs) return;
    this.clearTimer(info.idleTimer);
    const deadline = info.idleDeadline = this.now() + this.idleMs;
    info.idleTimer = this.setTimer(() => {
      if (this.recognizeStreams.get(socketId) === info && info.idleDeadline === deadline) this._limit(socketId, info, 'idle');
    }, this.idleMs);
  }

  _stopLimits(info) {
    this.clearTimer(info.sessionTimer);
    this.clearTimer(info.idleTimer);
    info.sessionTimer = null;
    info.idleTimer = null;
    info.idleDeadline = null;
  }

  _limit(socketId, info, reason) {
    if (this.recognizeStreams.get(socketId) !== info || info.unavailable) return;
    info.unavailable = true;
    this._stopStream(info);
    this._stopLimits(info);
    info.audioHistory = [];
    this.telemetry.record('speech_limited');
    // A deliberate caption retry creates a new binding; incoming audio cannot reopen it.
    this._status(socketId, info, { status: 'paused', reason, retryable: true });
  }

  _retry(socketId, info, error) {
    if (this.recognizeStreams.get(socketId) !== info || !info.socket.connected) return;
    this._stopStream(info);
    if ([3, 7, 16].includes(error.code)) {
      info.unavailable = true;
      this.telemetry.record('speech_unavailable');
      this._status(socketId, info, { status: 'unavailable', reason: 'configuration', retryable: false });
      return;
    }
    info.failureStartedAt ??= this.now();
    if (this.now() - info.failureStartedAt >= this.MAX_FAILURE_MS) {
      info.unavailable = true;
      this.telemetry.record('speech_unavailable');
      this._status(socketId, info, { status: 'unavailable', reason: 'provider', retryable: true });
      return;
    }
    this.telemetry.failure('speech_retry', Number.isInteger(error.code) && error.code >= 0 && error.code <= 16 ? error.code : undefined);
    this._status(socketId, info, { status: 'reconnecting' });
    const delay = info.retryDelay;
    info.retryDelay = Math.min(delay * 2, 30000);
    info.retryTimer = this.setTimer(() => {
      info.retryTimer = null;
      if (this.recognizeStreams.get(socketId) === info && info.socket.connected) {
        this.createRecognizeStream(socketId);
      }
    }, delay);
  }

  _status(socketId, info, data) {
    if (this.recognizeStreams.get(socketId) !== info || !info.socket.connected) return;
    info.status = data.status;
    info.socket.emit('captionStatus', data);
    if (info.onStatus) info.onStatus(data);
  }

  _dropped(socketId, info) {
    this.telemetry.record('audio_dropped');
    const now = this.now();
    if (info.droppedAt === null || now - info.droppedAt >= 5000) {
      info.droppedAt = now;
      this._status(socketId, info, { status: 'limited' });
    }
  }

  _stopStream(info) {
    this.clearTimer(info.restartTimer);
    this.clearTimer(info.retryTimer);
    info.restartTimer = null;
    info.retryTimer = null;
    const stream = info.stream;
    // Invalidate first: events from a destroyed stream must not restart it.
    info.stream = null;
    if (stream && !stream.destroyed) stream.destroy();
  }

  /** Accept bounded PCM chunks only from a registered, connected participant. */
  processAudio(socketId, data) {
    const info = this.recognizeStreams.get(socketId);
    if (!info || !info.socket.connected || info.retryTimer || info.unavailable) return;
    if (this._sessionExpired(socketId, info)) return;
    if (!data || !VALID_SAMPLE_RATES.has(data.sampleRate)) return;

    let audioBuffer;
    if (Array.isArray(data.buffer)) {
      if (data.buffer.length > 8192 || !data.buffer.every(
        value => Number.isInteger(value) && value >= -32768 && value <= 32767
      )) return;
      audioBuffer = Buffer.alloc(data.buffer.length * 2);
      data.buffer.forEach((value, index) => audioBuffer.writeInt16LE(value, index * 2));
    } else if (Buffer.isBuffer(data.buffer)) {
      audioBuffer = data.buffer;
    } else {
      return;
    }
    if (!audioBuffer.length || audioBuffer.length > 16384 || audioBuffer.length % 2) return;
    // Bound accepted audio to real-time throughput with a one-second burst.
    // Counting samples also catches oversized chunks below the packet rate limit.
    const now = this.now();
    const budget = info.budget;
    if (!budget) {
      info.budget = { tokens: 2000, at: now };
    } else {
      budget.tokens = Math.min(2000, budget.tokens + Math.max(0, now - budget.at));
      budget.at = now;
    }
    const duration = audioBuffer.length / 2 / data.sampleRate * 1000;
    if (info.budget.tokens < duration) { this._dropped(socketId, info); return; }
    info.budget.tokens -= duration;
    if (info.stream && info.sampleRateHertz !== data.sampleRate && now - info.streamStartedAt < 5000) {
      this._dropped(socketId, info);
      return;
    }
    if (!info.stream || info.sampleRateHertz !== data.sampleRate) {
      this.createRecognizeStream(socketId, info.languageCode, data.sampleRate);
    }
    if (!info.stream?.writable) return;
    // Do not accumulate delayed audio when the provider applies backpressure.
    if (info.stream.writableNeedDrain) { this._dropped(socketId, info); return; }
    try {
      const entry = { startMs: info.audioMs, endMs: info.audioMs + duration, buffer: Buffer.from(audioBuffer) };
      info.audioMs += duration;
      info.audioHistory.push(entry);
      while (info.audioHistory.length > 1024 || info.audioHistory[0]?.endMs <= info.audioMs - 5000) info.audioHistory.shift();
      info.stream.write(audioBuffer);
      this._armIdle(socketId, info);
    } catch (error) {
      this._retry(socketId, info, error);
    }
  }

  /** Cancel every timer and invalidate all callbacks on participant departure. */
  cleanup(socketId) {
    const info = this.recognizeStreams.get(socketId);
    if (!info) return;
    this.recognizeStreams.delete(socketId);
    this._stopStream(info);
    this._stopLimits(info);
  }
}

module.exports = new SpeechToTextService();
module.exports.SpeechToTextService = SpeechToTextService;
