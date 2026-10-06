const { test } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApplication } = require('../server');

async function fixture(t, overrides = {}) {
  const bindings = new Map();
  const speech = { bindSocketToStream: (id, socket, callback) => bindings.set(id, callback),
    processAudio() {}, cleanup: id => bindings.delete(id) };
  const application = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false' }, speech, ...overrides });
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${application.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await application.close(); });
  async function client() {
    const socket = connect(url, { transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  return { ...application, client, url, bindings };
}
const ack = (socket, event, data) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, data, (error, value) => error ? reject(error) : resolve(value));
});
const join = (socket, room = 'ABCD', userType = 'hearing') => ack(socket, 'join', { room, userType });
const receive = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Missing ${event}`)); }, 2000);
  const listener = data => { clearTimeout(timer); resolve(data); };
  socket.once(event, listener);
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const leave = socket => new Promise(resolve => socket.emit('leave', resolve));

test('credential-free startup serves the app with optional features disabled', async t => {
  const f = await fixture(t);
  assert.equal(await (await fetch(`${f.url}/health`)).text(), 'OK');
  assert.deepEqual(await (await fetch(`${f.url}/capabilities`)).json(), {
    captions: false, speechOutput: false, recognition: false, suggestions: false, avatar: false, privateRooms: false,
  });
  assert.equal((await fetch(`${f.url}/hearing.html`)).status, 200);
  assert.equal((await fetch(`${f.url}/pose?text=hello`)).status, 503);
});

test('captions can be enabled while paid speech output stays disabled', async t => {
  let synthesisCalls = 0;
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true', ENABLE_SPEECH_OUTPUT: 'false' },
    synthesize: async () => { synthesisCalls++; return 'unused'; } });
  assert.equal(f.capabilities.captions, true);
  assert.equal(f.capabilities.speechOutput, false);
  const a = await f.client(); const b = await f.client();
  await join(a); await join(b);
  const result = await ack(a, 'message:send', { id: 'no-paid-speech', text: 'Typed only', speak: true });
  assert.equal(result.ok, true);
  await wait(20);
  assert.equal(synthesisCalls, 0);
});

test('invalid caption capacity and duration configuration fails closed', () => {
  for (const env of [{ MAX_CAPTION_STREAMS: '0' }, { MAX_CAPTION_STREAMS: 'oops' },
    { CAPTION_MAX_SESSION_SECONDS: '-1' }, { CAPTION_MAX_SESSION_SECONDS: '1.5' },
    { CAPTION_IDLE_SECONDS: '301' }]) assert.throws(() => createApplication({ env }));
});

test('invalid connection capacity and admission timeout fail closed', () => {
  for (const env of [{ MAX_CONNECTIONS: '1' }, { MAX_CONNECTIONS: '10001' },
    { UNJOINED_TIMEOUT_SECONDS: '0' }, { UNJOINED_TIMEOUT_SECONDS: 'NaN' }]) {
    assert.throws(() => createApplication({ env }));
  }
});

test('actual server bounds connected clients and accepts a replacement after departure', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', MAX_CONNECTIONS: '2' } });
  const clients = await Promise.allSettled([f.client(), f.client(), f.client(), f.client()]);
  const accepted = clients.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.equal(accepted.length, 2);
  assert.equal(f.io.sockets.sockets.size, 2);
  await join(accepted[0]); await join(accepted[1]);
  const departed = receive(accepted[1], 'peer_disconnected');
  accepted[0].disconnect(); await departed;
  const replacement = await f.client();
  assert.equal((await join(replacement)).ok, true);
  assert.equal(f.io.sockets.sockets.size, 2);
});

test('actual server closes an unjoined client while preserving an admitted call', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', UNJOINED_TIMEOUT_SECONDS: '5' } });
  const a = await f.client(); const b = await f.client(); await join(a);
  const transport = await fetch(`${f.url}/socket.io/?EIO=4&transport=polling`);
  assert.equal(transport.status, 200);
  assert.equal(f.io.engine.clientsCount, 3);
  const closed = new Promise(resolve => b.once('disconnect', resolve));
  await Promise.race([closed, wait(7000).then(() => { throw new Error('Unjoined connection did not close'); })]);
  assert.equal(a.connected, true); assert.equal(b.connected, false);
  assert.equal(f.io.sockets.sockets.size, 1);
  assert.equal((await join(a)).ok, true);
  await wait(100);
  assert.equal(f.io.engine.clientsCount, 1);
});

test('invalid room/role payloads cannot create membership', async t => {
  const f = await fixture(t); const a = await f.client();
  for (const data of [null, {}, { room: ['ABCD'], userType: 'deaf' }, { room: 'abcd', userType: 'deaf' }]) {
    assert.equal((await ack(a, 'join', data)).code, 'invalid_room');
  }
  assert.equal((await join(a, 'ABCD', 'admin')).code, 'invalid_role');
  assert.equal(f.io.sockets.adapter.rooms.has('call:ABCD'), false);
});

test('concurrent admission never exceeds two; duplicate joins never renegotiate', async t => {
  const f = await fixture(t); const clients = await Promise.all([f.client(), f.client(), f.client()]);
  const results = await Promise.all(clients.map(socket => join(socket)));
  assert.equal(results.filter(result => result.ok).length, 2);
  assert.equal(results.filter(result => result.code === 'room_full').length, 1);
  const admitted = clients[results.findIndex(result => result.ok)];
  let ready = 0; admitted.on('ready', () => ready++);
  assert.equal((await join(admitted)).ok, true);
  await wait(30);
  assert.equal(ready, 0);
  assert.equal(f.io.sockets.adapter.rooms.get('call:ABCD').size, 2);
});

test('switching rooms requires departure and notifies the former peer', async t => {
  const f = await fixture(t); const a = await f.client(); const b = await f.client();
  await join(a); await join(b);
  assert.equal((await join(a, 'EFGH')).code, 'leave_room_first');
  const left = receive(b, 'peer_disconnected'); await leave(a); await left;
  assert.equal((await join(a, 'EFGH')).ok, true);
  assert.equal(f.io.sockets.adapter.rooms.get('call:ABCD').size, 1);
  assert.equal(f.io.sockets.adapter.rooms.get('call:EFGH').size, 1);
});

test('signaling is validated and isolated between rooms', async t => {
  const f = await fixture(t); const a = await f.client(); const b = await f.client(); const c = await f.client();
  await join(a); await join(b); await join(c, 'EFGH');
  let unrelated = 0; let invalid = 0;
  c.on('signal:offer', () => unrelated++); b.on('signal:offer', () => invalid++);
  const rejected = receive(a, 'protocolError');
  a.emit('signal:offer', { sdp: { type: 'answer', sdp: 'invalid' } });
  assert.equal((await rejected).code, 'invalid_payload'); assert.equal(invalid, 0);
  const incoming = receive(b, 'signal:offer');
  a.emit('signal:offer', { sdp: { type: 'offer', sdp: 'valid-test-sdp' } });
  assert.equal((await incoming).sdp.sdp, 'valid-test-sdp'); assert.equal(unrelated, 0);
});

test('messages require a peer, are bounded/idempotent, and preserve literal markup', async t => {
  const f = await fixture(t); const a = await f.client(); const b = await f.client();
  await join(a);
  assert.equal((await ack(a, 'message:send', { id: 'm1', text: 'hello' })).code, 'peer_unavailable');
  await join(b);
  for (const data of [null, { id: 'm2', text: '' }, { id: 'm3', text: 'x'.repeat(1001) }, { id: {}, text: 'hello' }]) {
    assert.equal((await ack(a, 'message:send', data)).code, 'invalid_message');
  }
  const incoming = receive(b, 'message:received'); let delivered = 0;
  b.on('message:received', () => delivered++);
  const message = { id: 'm4', text: '<img src=x onerror=alert(1)> مرحبا 👋' };
  const result = await ack(a, 'message:send', message);
  assert.equal((await incoming).text, message.text); assert.equal(result.ok, true);
  assert.deepEqual(await ack(a, 'message:send', message), result); assert.equal(delivered, 1);
  assert.equal((await ack(a, 'message:send', { ...message, text: 'different' })).code, 'message_id_conflict');
});

test('actual-server captions cannot leak buffered finals to a replacement peer', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' } });
  const a = await f.client(); const b = await f.client(); await join(a); await join(b);
  const received = receive(b, 'transcript');
  f.bindings.get(a.id)({ transcript: 'live', isFinal: false }); assert.equal((await received).isLocal, false);
  f.bindings.get(a.id)({ transcript: 'private old conversation', isFinal: true });
  const departure = receive(a, 'peer_disconnected'); b.disconnect(); await departure;
  const c = await f.client(); await join(c);
  let leaked = 0; c.on('transcript', () => leaked++); await wait(650); assert.equal(leaked, 0);
});

test('recognition drafts stay private and delayed suggestions stop after departure', async t => {
  let complete;
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_ASL: 'true', ANTHROPIC_API_KEY: 'test-placeholder' },
    interpretLetters: () => new Promise(resolve => { complete = resolve; }) });
  const a = await f.client(); const b = await f.client(); await join(a, 'ABCD', 'deaf'); await join(b);
  let guesses = 0;
  for (const event of ['aslWordResult', 'aslSentence', 'ttsAudio', 'aslDraft']) b.on(event, () => guesses++);
  a.emit('aslWord', { letters: ['H', 'I'] }); await wait(20); assert.equal(typeof complete, 'function');
  const left = receive(b, 'peer_disconnected'); await leave(a); await left;
  let drafts = 0; a.on('aslDraft', () => drafts++); complete('HI'); await wait(20);
  assert.equal(drafts, 0); assert.equal(guesses, 0);
});

test('delayed speech targets its original recipient, never a replacement peer', async t => {
  let finish;
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' },
    synthesize: () => new Promise(resolve => { finish = resolve; }) });
  const a = await f.client(); const b = await f.client(); await join(a); await join(b);
  assert.equal((await ack(a, 'message:send', { id: 'spoken', text: 'private', speak: true })).ok, true);
  const departure = receive(a, 'peer_disconnected'); b.disconnect(); await departure;
  const c = await f.client(); await join(c); let audio = 0; c.on('ttsAudio', () => audio++);
  finish('base64'); await wait(30); assert.equal(audio, 0);
});

test('prediction rejects malformed coordinates without calling Python', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_ASL: 'true' } });
  const response = await fetch(`${f.url}/api/predict`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ landmarks: Array(63).fill('x') }) });
  assert.equal(response.status, 400);
});

test('caption controls acknowledge pause/resume and advertise it to the peer', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' } });
  const a = await f.client(); const b = await f.client(); await join(a); await join(b);
  const status = receive(b, 'peerCaptionStatus');
  assert.equal((await ack(a, 'caption:state', { enabled: false })).ok, true);
  assert.equal((await status).status, 'paused');
  assert.equal(f.bindings.has(a.id), false);
  const resumed = receive(b, 'peerCaptionStatus');
  assert.equal((await ack(a, 'caption:state', { enabled: true })).ok, true);
  assert.equal((await resumed).status, 'ready');
  assert.equal(f.bindings.has(a.id), true);
  assert.equal((await ack(a, 'caption:state', { enabled: 'yes' })).code, 'invalid_payload');
});

test('caption pause discards buffered speech and a peer departure cannot resume a paused mic', async t => {
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' } });
  const a = await f.client(); const b = await f.client(); await join(a); await join(b);
  let received = 0; b.on('transcript', () => received++);
  f.bindings.get(a.id)({ transcript: 'not yet forwarded', isFinal: true });
  await ack(a, 'caption:state', { enabled: false }); await wait(650);
  assert.equal(received, 0);
  const departed = receive(a, 'peer_disconnected'); b.disconnect(); await departed;
  assert.equal(f.bindings.has(a.id), false);
});

test('peer departure clears recognizer context and replay audio before a replacement can join', async t => {
  const { EventEmitter } = require('node:events');
  const { SpeechToTextService } = require('../server/speechToText');
  const streams = [];
  const speech = new SpeechToTextService({ client: { streamingRecognize() {
    const stream = new EventEmitter(); stream.writable = true; stream.write = () => true;
    stream.destroy = () => { stream.destroyed = true; }; streams.push(stream); return stream;
  } } });
  const f = await fixture(t, { env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' }, speech });
  const a = await f.client(); const b = await f.client(); await join(a); await join(b);
  a.emit('audioData', { sampleRate: 16000, buffer: Buffer.alloc(2048) });
  await wait(20);
  const info = speech.recognizeStreams.get(a.id);
  assert.equal(info.audioHistory.length, 1);
  await leave(b);
  assert.equal(streams[0].destroyed, true);
  assert.equal(speech.recognizeStreams.get(a.id).audioHistory.length, 0);
  const c = await f.client(); await join(c);
  let delivered = false; c.on('transcript', () => { delivered = true; });
  streams[0].emit('data', { results: [{ isFinal: true, alternatives: [{ transcript: 'private old context' }] }] });
  await wait(20); assert.equal(delivered, false);
});
