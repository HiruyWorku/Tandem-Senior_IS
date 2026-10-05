const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { SpeechToTextService } = require('../server/speechToText');

function fixture(options = {}) {
  const streams = [];
  const requests = [];
  const timers = new Map();
  const emissions = [];
  const forwarded = [];
  let timerId = 0;
  let now = 0;
  const client = {
    streamingRecognize(request) {
      requests.push(request);
      const stream = new EventEmitter();
      stream.writable = true;
      stream.writes = [];
      stream.write = buffer => { stream.writes.push(buffer); return true; };
      stream.destroy = () => { stream.destroyed = true; stream.emit('end'); };
      streams.push(stream);
      return stream;
    },
  };
  const service = new SpeechToTextService({
    ...options, client, now: () => now,
    setTimer: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
  });
  const socket = { connected: true, emit: (...args) => emissions.push(args) };
  service.bindSocketToStream('peer', socket, result => forwarded.push(result));
  const send = (sampleRate = 48000) => service.processAudio('peer', {
    sampleRate, buffer: [0, 32767, -32768],
  });
  const fire = id => {
    const { callback } = timers.get(id);
    timers.delete(id);
    callback();
  };
  return { service, streams, requests, timers, emissions, forwarded, socket, send, fire,
    setNow: value => { now = value; } };
}

test('recognition starts on audio, using actual sample rate and explicit little-endian PCM', () => {
  const f = fixture();
  assert.equal(f.streams.length, 0);
  f.send(44100);
  assert.equal(f.requests[0].config.sampleRateHertz, 44100);
  assert.deepEqual([...f.streams[0].writes[0]], [0, 0, 255, 127, 0, 128]);
  f.service.cleanup('peer');
});

test('every provider result reaches local captions and the peer forwarding callback once', () => {
  const f = fixture();
  f.send();
  f.streams[0].emit('data', { results: [
    { isFinal: false, alternatives: [{ transcript: 'hello' }] },
    { isFinal: true, alternatives: [{ transcript: 'hello world', confidence: 0.9 }] },
  ] });
  assert.equal(f.forwarded.length, 2);
  assert.equal(f.emissions.filter(([event]) => event === 'transcript').length, 2);
  assert.equal(f.forwarded[1].isLocal, true);
  assert.equal(f.forwarded[1].transcript, 'hello world');
  f.service.cleanup('peer');
});

test('scheduled rotation preserves socket binding and ignores stale results', () => {
  const f = fixture();
  f.send();
  const old = f.streams[0];
  const timer = f.service.recognizeStreams.get('peer').restartTimer;
  assert.equal(f.timers.get(timer).delay, 270000);
  f.fire(timer);
  assert.equal(old.destroyed, true);
  assert.equal(f.streams.length, 2);
  old.emit('data', { results: [{ alternatives: [{ transcript: 'stale' }] }] });
  f.streams[1].emit('data', { results: [{ alternatives: [{ transcript: 'fresh' }] }] });
  assert.deepEqual(f.forwarded.map(result => result.transcript), ['fresh']);
  f.service.cleanup('peer');
});

test('sample rate changes replace the stream without losing participant state', () => {
  const f = fixture();
  f.send();
  f.setNow(5000);
  f.send(44100);
  assert.equal(f.streams[0].destroyed, true);
  assert.equal(f.streams[1].writes.length, 1);
  assert.equal(f.service.recognizeStreams.get('peer').socket, f.socket);
  f.service.cleanup('peer');
});

test('retry backoff persists, stops after five minutes, and does not restart on new audio', () => {
  const f = fixture();
  f.send();
  f.streams[0].emit('error', new Error('offline'));
  let info = f.service.recognizeStreams.get('peer');
  assert.equal(f.timers.get(info.retryTimer).delay, 1000);
  f.send();
  assert.equal(f.streams.length, 1);
  f.fire(info.retryTimer);
  f.streams[1].emit('error', new Error('offline'));
  assert.equal(f.timers.get(info.retryTimer).delay, 2000);
  f.fire(info.retryTimer);
  f.setNow(300000);
  f.streams[2].emit('error', new Error('offline'));
  assert.equal(info.unavailable, true);
  assert.equal(f.timers.size, 0);
  f.send();
  assert.equal(f.streams.length, 3);
  assert.deepEqual(f.emissions.at(-1), ['captionStatus', { status: 'unavailable', reason: 'provider', retryable: true }]);
  f.service.cleanup('peer');
});

test('cleanup cancels retry and even an already queued callback cannot resurrect a stream', () => {
  const f = fixture();
  f.send();
  f.streams[0].emit('error', new Error('offline'));
  const callback = f.timers.get(f.service.recognizeStreams.get('peer').retryTimer).callback;
  f.service.cleanup('peer');
  callback();
  f.send();
  assert.equal(f.timers.size, 0);
  assert.equal(f.streams.length, 1);
  assert.equal(f.service.recognizeStreams.size, 0);
});

test('invalid, oversized and disconnected audio never opens a provider stream', () => {
  const f = fixture();
  for (const data of [null, {}, { sampleRate: 48000, buffer: [NaN] },
    { sampleRate: 48000, buffer: [32768] }, { sampleRate: 1, buffer: [0] },
    { sampleRate: 48000, buffer: new Array(8193).fill(0) },
    { sampleRate: 48000, buffer: Buffer.alloc(3) }]) {
    f.service.processAudio('peer', data);
  }
  f.socket.connected = false;
  f.send();
  assert.equal(f.streams.length, 0);
  f.service.cleanup('peer');
});

test('provider backpressure does not accumulate delayed audio', () => {
  const f = fixture();
  f.send();
  f.streams[0].writableNeedDrain = true;
  f.send();
  assert.equal(f.streams[0].writes.length, 1);
  f.service.cleanup('peer');
});

test('configuration failures stop retries and do not report an accepted stream', () => {
  const f = fixture(); f.send();
  assert.deepEqual(f.emissions.at(-1), ['captionStatus', { status: 'starting' }]);
  const error = new Error('invalid credentials'); error.code = 16;
  f.streams[0].emit('error', error);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.emissions.at(-1), ['captionStatus', { status: 'unavailable', reason: 'configuration', retryable: false }]);
  f.send(); assert.equal(f.streams.length, 1);
  f.service.cleanup('peer');
});

test('provider data makes captions active and status callbacks reach the bound participant', () => {
  const f = fixture(); const statuses = [];
  f.service.bindSocketToStream('peer', f.socket, result => f.forwarded.push(result), status => statuses.push(status.status));
  f.send(); assert.deepEqual(statuses, ['starting']);
  f.streams[0].emit('data', { results: [{ isFinal: true, alternatives: [{ transcript: 'accepted' }] }] });
  assert.deepEqual(statuses, ['starting', 'active']);
  f.service.cleanup('peer');
});

test('real-time sample budget blocks accelerated audio and does not reset with sample rates', () => {
  const f = fixture();
  const sendChunk = rate => f.service.processAudio('peer', { sampleRate: rate, buffer: Buffer.alloc(16000) });
  for (let i = 0; i < 4; i++) sendChunk(16000);
  assert.equal(f.streams[0].writes.length, 4);
  sendChunk(16000); sendChunk(44100);
  assert.equal(f.streams[0].writes.length, 4);
  assert.equal(f.streams.length, 1);
  assert.equal(f.emissions.at(-1)[1].status, 'limited');
  f.setNow(500); sendChunk(16000);
  assert.equal(f.streams[0].writes.length, 5);
  f.service.cleanup('peer');
});

test('rapid sample-rate changes cannot churn provider streams', () => {
  const f = fixture(); f.send();
  for (let i = 0; i < 10; i++) f.send(i % 2 ? 16000 : 44100);
  assert.equal(f.streams.length, 1);
  f.service.cleanup('peer');
});

test('caption capacity blocks new streams and a manual rebind can recover after capacity frees', () => {
  const f = fixture({ maxStreams: 1 }); f.send();
  const status = [];
  const socket = { connected: true, emit: (_event, data) => status.push(data) };
  f.service.bindSocketToStream('second', socket);
  f.service.processAudio('second', { sampleRate: 16000, buffer: Buffer.alloc(2048) });
  assert.equal(f.streams.length, 1);
  assert.deepEqual(status.at(-1), { status: 'unavailable', reason: 'capacity', retryable: true });
  f.service.cleanup('peer'); f.service.cleanup('second'); f.service.bindSocketToStream('second', socket);
  f.service.processAudio('second', { sampleRate: 16000, buffer: Buffer.alloc(2048) });
  assert.equal(f.streams.length, 2);
  f.service.cleanup('second');
});

test('rotation replays only audio after the last timed final and suppresses duplicate finals by time', () => {
  const f = fixture();
  const send = () => f.service.processAudio('peer', { sampleRate: 16000, buffer: Buffer.alloc(16000) });
  send(); send(); // One second of accepted audio.
  f.streams[0].emit('data', { results: [{ isFinal: true, resultEndTime: { seconds: 0, nanos: 500000000 }, alternatives: [{ transcript: 'first' }] }] });
  f.fire(f.service.recognizeStreams.get('peer').restartTimer);
  assert.equal(f.streams[1].writes.reduce((sum, buffer) => sum + buffer.length, 0), 16000);
  f.streams[1].emit('data', { results: [{ isFinal: true, resultEndTime: { seconds: 0, nanos: 500000000 }, alternatives: [{ transcript: 'second' }] }] });
  f.streams[1].emit('data', { results: [{ isFinal: true, resultEndTime: { seconds: 0, nanos: 500000000 }, alternatives: [{ transcript: 'duplicate second' }] }] });
  assert.deepEqual(f.forwarded.map(result => result.transcript), ['first', 'second']);
  f.service.cleanup('peer');
});

test('replay is bounded, preserves repeated words at different times, and clears on cleanup', () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) {
    f.setNow(index * 500);
    f.service.processAudio('peer', { sampleRate: 16000, buffer: Buffer.alloc(16000) });
  }
  const info = f.service.recognizeStreams.get('peer');
  assert.equal(info.audioHistory.length, 10);
  f.fire(info.restartTimer);
  assert.equal(f.streams[1].writes.reduce((sum, buffer) => sum + buffer.length, 0), 160000);
  for (const seconds of [1, 2]) f.streams[1].emit('data', { results: [{ isFinal: true, resultEndTime: { seconds }, alternatives: [{ transcript: 'yes' }] }] });
  assert.deepEqual(f.forwarded.map(result => result.transcript), ['yes', 'yes']);
  f.service.cleanup('peer'); assert.equal(f.service.recognizeStreams.size, 0);
});

test('retry replays pending audio but sample-rate change cannot reinterpret old PCM', () => {
  const f = fixture(); f.send();
  f.streams[0].emit('error', new Error('network'));
  f.fire(f.service.recognizeStreams.get('peer').retryTimer);
  assert.equal(f.streams[1].writes.length, 1);
  f.setNow(5000); f.send(44100);
  assert.equal(f.streams[2].writes.length, 1);
  f.service.cleanup('peer');
});
