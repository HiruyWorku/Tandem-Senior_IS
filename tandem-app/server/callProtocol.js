const { randomUUID } = require('node:crypto');
const { createCaptionRelay } = require('./captionRelay');

const ROOM_RE = /^[A-Z0-9]{4,12}$/;
const ROLES = new Set(['deaf', 'hearing']);
const MESSAGE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const roomName = code => `call:${code}`;

/** Register the single-instance call protocol with bounded optional provider work. */
function registerCallProtocol(io, { speech, interpretLetters, synthesize, capabilities, now = Date.now, authorizeRoom = () => true, telemetry = { record() {} } }) {
  let activeProviderJobs = 0;
  const MAX_PROVIDER_JOBS = 8;
  const roomSize = room => io.sockets.adapter.rooms.get(room)?.size || 0;

  io.on('connection', socket => {
    let session = null;
    const rates = new Map();
    let admission = Promise.resolve();

    function captionStatus(data) {
      if (!session) return;
      session.captionStatus = data;
      socket.to(socket.room).emit('peerCaptionStatus', data);
    }

    function bindCaptions() {
      speech.bindSocketToStream(socket.id, socket, session.relay.accept, captionStatus);
    }

    function allowed(key, count, interval) {
      const current = now();
      let rate = rates.get(key);
      if (!rate || current >= rate.until) {
        rate = { count: 0, until: current + interval };
        rates.set(key, rate);
      }
      return ++rate.count <= count;
    }

    const currentSession = captured => socket.connected && session === captured && !!socket.room;
    const reject = (event, code) => socket.emit('protocolError', { event, code });
    const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };

    function leave() {
      const previous = session;
      session = null;
      previous?.relay.dispose();
      speech.cleanup(socket.id);
      if (socket.room) {
        for (const id of io.sockets.adapter.rooms.get(socket.room) || []) {
          const peer = io.sockets.sockets.get(id);
          if (peer && peer !== socket) peer.onPeerDeparture?.();
        }
        socket.to(socket.room).emit('peer_disconnected');
        socket.leave(socket.room);
      }
      socket.room = undefined;
      socket.roomCode = undefined;
      socket.userType = undefined;
    }

    socket.on('join', (data, ack) => {
      // Admission is serialized per socket so repeated packets cannot interleave.
      admission = admission.then(async () => {
        if (!socket.connected) return;
        if (!allowed('join', 10, 10000)) return reply(ack, { ok: false, code: 'rate_limited' });
        if (!data || typeof data.room !== 'string' || !ROOM_RE.test(data.room)) {
          socket.emit('invalid_room');
          return reply(ack, { ok: false, code: 'invalid_room' });
        }
        if (!ROLES.has(data.userType)) {
          reject('join', 'invalid_role');
          return reply(ack, { ok: false, code: 'invalid_role' });
        }
        if (!authorizeRoom(data, socket)) {
          telemetry.record('room_rejected');
          reject('join', 'invalid_invitation');
          return reply(ack, { ok: false, code: 'invalid_invitation' });
        }
        if (session) {
          if (socket.roomCode !== data.room || socket.userType !== data.userType) {
            reject('join', 'leave_room_first');
            return reply(ack, { ok: false, code: 'leave_room_first' });
          }
          const joined = { room: socket.roomCode, peers: roomSize(socket.room), userType: socket.userType };
          socket.emit('joined', joined);
          return reply(ack, { ok: true, ...joined });
        }
        const room = roomName(data.room);
        if (roomSize(room) >= 2) {
          socket.emit('room_full');
          return reply(ack, { ok: false, code: 'room_full' });
        }
        // This service deliberately uses Socket.IO's synchronous in-memory adapter.
        // A distributed deployment needs atomic admission in its shared room store.
        await socket.join(room);
        if (!socket.connected) { socket.leave(room); return; }
        socket.room = room;
        socket.roomCode = data.room;
        socket.userType = data.userType;
        telemetry.record('room_joined');
        session = { id: randomUUID(), relay: createCaptionRelay(socket), messages: new Map(), interpreting: false };
        if (capabilities.captions) bindCaptions();
        const status = { status: capabilities.captions ? 'ready' : 'disabled' };
        socket.emit('captionStatus', status);
        captionStatus(status);
        const joined = { room: data.room, peers: roomSize(room), userType: data.userType };
        socket.emit('joined', joined);
        reply(ack, { ok: true, ...joined });
        if (joined.peers === 2) {
          for (const id of io.sockets.adapter.rooms.get(room)) {
            const peer = io.sockets.sockets.get(id);
            if (peer !== socket) socket.emit('peerCaptionStatus', peer.currentCaptionStatus?.() || { status: 'disabled' });
          }
          const ids = [...io.sockets.adapter.rooms.get(room)].sort();
          ids.forEach((id, index) => io.to(id).emit('ready', { polite: index === 1 }));
          socket.emit('initiate');
        }
      }).catch(() => {
        reject('join', 'join_failed');
        reply(ack, { ok: false, code: 'join_failed' });
      });
    });

    socket.on('leave', ack => {
      admission = admission.then(() => {
        leave();
        reply(ack, { ok: true });
      });
    });
    socket.on('disconnect', leave);
    // Internal cleanup is invoked directly, never accepted as a client event.
    socket.onPeerDeparture = () => {
      if (!session) return;
      session.relay.dispose();
      session.relay = createCaptionRelay(socket);
      speech.cleanup(socket.id); // Discard private replay audio and provider context from the departed peer.
      if (capabilities.captions && !session.captionsPaused) {
        bindCaptions();
        const status = { status: 'ready' };
        socket.emit('captionStatus', status);
        captionStatus(status);
      }
    };
    socket.currentCaptionStatus = () => session?.captionStatus;

    function signal(event, validate) {
      socket.on(event, payload => {
        if (!session) return reject(event, 'not_joined');
        if (!allowed('signal', 120, 10000)) return reject(event, 'rate_limited');
        if (!validate(payload)) return reject(event, 'invalid_payload');
        socket.to(socket.room).emit(event, payload);
      });
    }
    for (const type of ['offer', 'answer']) {
      signal(`signal:${type}`, payload => payload?.sdp?.type === type &&
        typeof payload.sdp.sdp === 'string' && payload.sdp.sdp.length > 0 && payload.sdp.sdp.length <= 100000);
    }
    signal('signal:ice-candidate', payload => {
      const candidate = payload?.candidate;
      return candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 2048 &&
        (candidate.sdpMid == null || (typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 64)) &&
        (candidate.sdpMLineIndex == null || (Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex <= 64)) &&
        (candidate.usernameFragment == null || (typeof candidate.usernameFragment === 'string' && candidate.usernameFragment.length <= 256));
    });

    socket.on('client:health', data => {
      if (!session || !allowed('health', 6, 60000)) return;
      if (['ice_renewed', 'ice_failed', 'media_failed', 'video_playback_retry'].includes(data?.event)) telemetry.record(`client_${data.event}`);
    });

    socket.on('audioData', data => {
      if (!session || !capabilities.captions || !allowed('audio', 60, 1000)) return;
      try { speech.processAudio(socket.id, data); } catch {
        speech.cleanup(socket.id);
        const status = { status: 'unavailable', retryable: true };
        socket.emit('captionStatus', status);
        captionStatus(status);
      }
    });
    socket.on('caption:state', (data, ack) => {
      if (!session || !capabilities.captions) return reply(ack, { ok: false, code: 'unavailable' });
      if (typeof data?.enabled !== 'boolean') return reply(ack, { ok: false, code: 'invalid_payload' });
      if (!allowed('caption:state', 10, 10000)) return reply(ack, { ok: false, code: 'rate_limited' });
      session.relay.dispose();
      session.relay = createCaptionRelay(socket);
      speech.cleanup(socket.id);
      session.captionsPaused = !data.enabled;
      if (data.enabled) bindCaptions();
      const status = { status: data.enabled ? 'ready' : 'paused' };
      socket.emit('captionStatus', status);
      captionStatus(status);
      reply(ack, { ok: true });
    });

    for (const event of ['signingDone', 'ttsSpoken']) {
      socket.on(event, () => {
        if (session && allowed(event, 20, 10000)) socket.to(socket.room).emit(event);
      });
    }

    socket.on('message:send', async (data, ack) => {
      const captured = session;
      if (!captured) return reply(ack, { ok: false, code: 'not_joined' });
      if (!data || typeof data.id !== 'string' || !MESSAGE_ID_RE.test(data.id) || typeof data.text !== 'string' ||
        !data.text.trim() || data.text.length > 1000 || (data.speak !== undefined && typeof data.speak !== 'boolean')) {
        return reply(ack, { ok: false, code: 'invalid_message' });
      }
      const existing = captured.messages.get(data.id);
      if (existing) {
        if (existing.text !== data.text.trim() || existing.speak !== Boolean(data.speak)) {
          return reply(ack, { ok: false, code: 'message_id_conflict' });
        }
        return reply(ack, { ok: true, message: existing });
      }
      if (!allowed('message', 20, 10000)) return reply(ack, { ok: false, code: 'rate_limited' });
      if (roomSize(socket.room) !== 2) return reply(ack, { ok: false, code: 'peer_unavailable' });
      const message = { id: data.id, text: data.text.trim(), speak: Boolean(data.speak),
        userType: socket.userType, sentAt: now() };
      const recipientId = [...io.sockets.adapter.rooms.get(socket.room)].find(id => id !== socket.id);
      captured.messages.set(data.id, message);
      if (captured.messages.size > 100) captured.messages.delete(captured.messages.keys().next().value);
      telemetry.record('message_sent');
      socket.to(socket.room).emit('message:received', message);
      reply(ack, { ok: true, message });
      if (!message.speak) return;
      if (!capabilities.speechOutput || activeProviderJobs >= MAX_PROVIDER_JOBS) {
        socket.emit('speechStatus', { id: message.id, status: 'unavailable' });
        return;
      }
      activeProviderJobs++;
      try {
        const audioBase64 = await synthesize(message.text);
        if (currentSession(captured) && io.sockets.sockets.get(recipientId)?.room === socket.room) {
          io.to(recipientId).emit('ttsAudio', { audioBase64, messageId: message.id });
        }
      } catch {
        telemetry.record('speech_job_failed');
        if (currentSession(captured)) socket.emit('speechStatus', { id: message.id, status: 'unavailable' });
      } finally { activeProviderJobs--; }
    });

    // Recognition drafts are private to the signer. Only message:send communicates them.
    socket.on('aslWord', async data => {
      const captured = session;
      if (!captured || socket.userType !== 'deaf' || !capabilities.recognition) return;
      if (!Array.isArray(data?.letters) || data.letters.length < 1 || data.letters.length > 32 ||
        !data.letters.every(letter => typeof letter === 'string' && /^[A-Z]$/.test(letter))) {
        return reject('aslWord', 'invalid_payload');
      }
      if (!allowed('aslWord', 10, 10000) || captured.interpreting || activeProviderJobs >= MAX_PROVIDER_JOBS) {
        return reject('aslWord', 'busy');
      }
      const letters = [...data.letters];
      const raw = letters.join('');
      if (!capabilities.suggestions) return socket.emit('aslDraft', { raw, suggestion: raw });
      captured.interpreting = true;
      activeProviderJobs++;
      try {
        const suggestion = await interpretLetters(letters);
        if (currentSession(captured)) socket.emit('aslDraft', { raw,
          suggestion: typeof suggestion === 'string' && suggestion.length <= 100 ? suggestion : raw });
      } catch {
        if (currentSession(captured)) socket.emit('aslDraft', { raw, suggestion: raw, unavailable: true });
      } finally {
        captured.interpreting = false;
        activeProviderJobs--;
      }
    });
  });
  return { providerJobs: () => activeProviderJobs };
}

module.exports = { registerCallProtocol };
