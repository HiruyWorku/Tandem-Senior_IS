const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createAccess, createRateLimit } = require('../server/access');
const { createIceConfig } = require('../server/iceConfig');
const { createApplication } = require('../server');
const { io: connect } = require('socket.io-client');
const secret = 'a-long-persistent-test-secret-at-least-32-bytes';
const production = { NODE_ENV: 'production', ROOM_SIGNING_SECRET: secret, ALLOWED_ORIGIN: 'https://tandem.example.com' };

test('invitations reject expiry, tampering, malformed credentials, and different rooms', () => {
  let time = 1700000000000;
  const access = createAccess({ ROOM_SIGNING_SECRET: secret, ROOM_TTL_SECONDS: '300' }, () => time);
  const invite = access.mint();
  assert.equal(access.required, true);
  assert.equal(access.verify(invite.token, invite.room).room, invite.room);
  assert.equal(access.verify(invite.token, 'OTHER'), null);
  const [body, signature] = invite.token.split('.');
  const changed = Buffer.from(JSON.stringify({ v: 1, room: 'OTHER', exp: invite.expiresAt })).toString('base64url');
  for (const value of [undefined, '', 'a.b.c', `${changed}.${signature}`, `${body}.AAAA`, {}, 'a'.repeat(1000)]) assert.equal(access.verify(value), null);
  time += 300000;
  assert.equal(access.verify(invite.token), null);
});

test('persistent secrets survive restarts; ephemeral development secrets do not', () => {
  const a = createAccess({ ROOM_SIGNING_SECRET: secret });
  const invite = a.mint();
  assert.ok(createAccess({ ROOM_SIGNING_SECRET: secret }).verify(invite.token));
  assert.equal(createAccess({}).verify(createAccess({}).mint().token), null);
});

test('production fails closed on missing secrets, insecure origins, and legacy admission', () => {
  assert.doesNotThrow(() => createApplication({ env: production }));
  for (const env of [{ NODE_ENV: 'production' }, { ...production, ROOM_SIGNING_SECRET: 'short' },
    { ...production, ALLOWED_ORIGIN: '*' }, { ...production, ALLOWED_ORIGIN: 'http://example.com' },
    { ...production, REQUIRE_ROOM_TOKEN: 'false' }, { ROOM_TTL_SECONDS: 'NaN' }]) {
    assert.throws(() => createApplication({ env }));
  }
});

test('origin matching is exact and applies independently of browser CORS', () => {
  const access = createAccess(production);
  const request = origin => ({ headers: { origin, host: 'tandem.example.com' } });
  assert.equal(access.originAllowed(request('https://tandem.example.com')), true);
  for (const origin of ['null', 'https://tandem.example.com.attacker.com', 'http://tandem.example.com']) assert.equal(access.originAllowed(request(origin)), false);
  assert.equal(createAccess({}).originAllowed({ headers: { origin: 'http://localhost:3000', host: 'localhost:3000' } }), true);
});

test('bounded rate windows recover after expiry and never trust extra keys to bypass capacity', () => {
  let time = 0;
  const allowed = createRateLimit({ limit: 2, interval: 1000, capacity: 1, now: () => time });
  assert.equal(allowed('one'), true); assert.equal(allowed('one'), true);
  assert.equal(allowed('one'), false); assert.equal(allowed('two'), false);
  time = 1000; assert.equal(allowed('two'), true);
});

test('TURN credentials use coturn HMAC, distinct identities, and bounded invitation expiry', () => {
  const env = { TURN_URLS: 'turn:relay.example.com:3478,turns:relay.example.com:5349?transport=tcp', TURN_SHARED_SECRET: secret, TURN_TTL_SECONDS: '600' };
  const ice = createIceConfig(env, () => 1700000000000);
  const a = ice({ exp: 1700000300 })[1]; const b = ice({ exp: 1700000300 })[1];
  assert.equal(a.username.split(':')[0], '1700000300');
  assert.notEqual(a.username, b.username);
  assert.equal(a.credential, createHmac('sha1', secret).update(a.username).digest('base64'));
  assert.equal(JSON.stringify(a).includes(secret), false);
  assert.equal(ice()[1].username.split(':')[0], '1700000600');
  assert.equal(a.urls.length, 2);
});

test('invalid TURN configuration and static production credentials fail at startup', () => {
  for (const env of [{ TURN_URLS: 'https://example.com' }, { TURN_URLS: 'turn:relay.example.com' },
    { TURN_SHARED_SECRET: secret }, { TURN_TTL_SECONDS: '0' },
    { NODE_ENV: 'production', TURN_USERNAME: 'static', TURN_CREDENTIAL: 'secret' }]) assert.throws(() => createIceConfig(env));
});

async function fixture(t, env = {}) {
  const application = createApplication({ env });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${application.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await application.close(); });
  return { ...application, url, client: async (origin) => {
    const socket = connect(url, { transports: ['websocket'], reconnection: false, extraHeaders: origin ? { Origin: origin } : {} });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  } };
}
const ack = (socket, data) => new Promise((resolve, reject) => socket.timeout(2000).emit('join', data, (error, result) => error ? reject(error) : resolve(result)));
const mint = async url => (await fetch(`${url}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();

test('actual server rejects room-code-only access and scopes invitations to one room', async t => {
  const f = await fixture(t);
  const invite = await mint(f.url); const a = await f.client(); const b = await f.client();
  assert.equal((await ack(a, { room: invite.room, userType: 'hearing' })).code, 'invalid_invitation');
  assert.equal(f.io.sockets.adapter.rooms.has(`call:${invite.room}`), false);
  assert.equal((await ack(a, { room: 'OTHER', userType: 'hearing', token: invite.token })).code, 'invalid_invitation');
  assert.equal((await ack(a, { ...invite, userType: 'hearing' })).ok, true);
  assert.equal((await ack(b, { ...invite, userType: 'deaf' })).ok, true);
  const c = await f.client(); assert.equal((await ack(c, { ...invite, userType: 'deaf' })).code, 'room_full');
});

test('protected ICE and provider endpoints require valid bearer credentials without caching', async t => {
  const f = await fixture(t, { TURN_URLS: 'turn:relay.example.com:3478', TURN_SHARED_SECRET: secret });
  for (const path of ['/ice-config', '/pose?text=test']) assert.equal((await fetch(f.url + path)).status, 403);
  assert.equal((await fetch(`${f.url}/api/predict`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  const invite = await mint(f.url);
  const headers = { Authorization: `Bearer ${invite.token}` };
  const res = await fetch(`${f.url}/ice-config`, { headers });
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).length, 2);
  assert.equal((await fetch(`${f.url}/ice-config?token=${invite.token}`)).status, 403);
  const valid = await fetch(`${f.url}/api/rooms/validate`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: invite.room }) });
  assert.equal(valid.status, 200); assert.equal((await valid.json()).room, invite.room);
});

test('room creation is rate limited and cross-origin sockets are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/api/rooms`, { method: 'POST', headers: { Origin: 'https://attacker.example.com' } })).status, 403);
  await assert.rejects(f.client('https://attacker.example.com'));
  for (let index = 0; index < 10; index++) assert.equal((await fetch(`${f.url}/api/rooms`, { method: 'POST' })).status, 201);
  const rejected = await fetch(`${f.url}/api/rooms`, { method: 'POST' });
  assert.equal(rejected.status, 429); assert.equal(rejected.headers.get('retry-after'), '3600');
});
