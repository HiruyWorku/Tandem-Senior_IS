const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createObservability } = require('../server/observability');
const { createApplication } = require('../server');
const { io: connect } = require('socket.io-client');
const token = 'a-random-metrics-token-with-at-least-32-bytes';

test('monitoring uses fixed event labels and sanitized error codes only', () => {
  const logs = [];
  const metrics = createObservability({ env: { METRICS_TOKEN: token }, logger: event => logs.push(event) });
  metrics.record('room_joined'); metrics.record('secret conversation');
  metrics.failure('speech_retry', new Error('secret conversation'));
  metrics.failure('secret conversation', 500);
  metrics.observe(0.02);
  const output = metrics.render({ sockets: 2, rooms: 1, streams: 2, jobs: 1 });
  assert.match(output, /event="room_joined"\} 1/);
  assert.match(output, /tandem_http_duration_seconds_bucket\{le="0.05"\} 1/);
  assert.match(output, /tandem_caption_streams 2/);
  assert.equal(output.includes('secret conversation'), false); assert.equal(output.includes(token), false);
  assert.deepEqual(logs, [{ event: 'speech_retry', code: 'unknown' }]);
  assert.equal(metrics.authorized(`Bearer ${token}`), true);
  for (const header of [undefined, token, 'Bearer wrong', 'a'.repeat(1000)]) assert.equal(metrics.authorized(header), false);
  assert.throws(() => createObservability({ env: { METRICS_TOKEN: 'short' } }));
});

async function fixture(t, env) {
  const application = createApplication({ env, logger: () => {} });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${application.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(client => client.disconnect()); await application.close(); });
  return { ...application, url, client: async () => {
    const socket = connect(url, { transports: ['websocket'] }); clients.push(socket);
    await new Promise(resolve => socket.once('connect', resolve)); return socket;
  } };
}
const ack = (socket, data) => new Promise(resolve => socket.emit('join', data, resolve));

test('metrics endpoint is disabled by default and readiness reports process admission state', async t => {
  const f = await fixture(t, {});
  assert.equal((await fetch(`${f.url}/metrics`)).status, 404);
  assert.deepEqual(await (await fetch(`${f.url}/ready`)).json(), { ready: true });
});

test('authenticated metrics report real room counts and ignore arbitrary client telemetry', async t => {
  const f = await fixture(t, { METRICS_TOKEN: token, REQUIRE_ROOM_TOKEN: 'false' });
  assert.equal((await fetch(`${f.url}/metrics`)).status, 403);
  assert.equal((await fetch(`${f.url}/metrics?token=${token}`)).status, 403);
  const a = await f.client(); const b = await f.client();
  await ack(a, { room: 'METRICS', userType: 'deaf' }); await ack(b, { room: 'METRICS', userType: 'hearing' });
  a.emit('client:health', { event: 'arbitrary secret' });
  a.emit('client:health', { event: 'ice_renewed', text: 'private conversation', token });
  a.emit('client:health', { event: 'video_playback_retry', text: 'private conversation', token });
  const response = await fetch(`${f.url}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
  const output = await response.text();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(output, /tandem_rooms 1/); assert.match(output, /tandem_sockets 2/);
  assert.match(output, /event="room_joined"\} 2/);
  assert.match(output, /event="client_video_playback_retry"\} 1/);
  assert.equal(output.includes('METRICS'), false); assert.equal(output.includes('private conversation'), false);
  assert.equal(output.includes('arbitrary secret'), false); assert.equal(output.includes(token), false);
});

test('protected metrics report durable aggregate allowance and unreadable ledger without breaking readiness', async t => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-budget-metrics-'));
  const file = path.join(directory, 'ledger');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(file, JSON.stringify({ version: 1, day: new Date().toISOString().slice(0, 10), reservedMs: 15000 }));
  const f = await fixture(t, { METRICS_TOKEN: token, CAPTION_DAILY_SECONDS: '30', CAPTION_BUDGET_FILE: file });
  const read = async () => (await fetch(f.url + '/metrics', { headers: { Authorization: `Bearer ${token}` } })).text();
  const metrics = await read();
  assert.match(metrics, /tandem_caption_budget_available 1/);
  assert.match(metrics, /tandem_caption_budget_reserved_seconds 15/);
  assert.match(metrics, /tandem_caption_budget_remaining_seconds 15/);
  assert.equal(metrics.includes(file), false);
  fs.writeFileSync(file, 'corrupt');
  const failed = await read();
  assert.match(failed, /tandem_caption_budget_available 0/);
  assert.match(failed, /tandem_caption_budget_remaining_seconds 0/);
  assert.equal(failed.includes('tandem_caption_budget_reserved_seconds'), false);
  assert.equal((await fetch(f.url + '/ready')).status, 200);
});

test('avatar failures never log or return upstream conversation bodies and invalid input makes no provider call', async t => {
  const express = require('express'); const http = require('node:http');
  const { createPoseProxy } = require('../server/poseProxy');
  const logs = [];
  const telemetry = createObservability({ logger: event => logs.push(event) });
  let calls = 0;
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use(createPoseProxy({ telemetry, fetchPose: async () => {
    calls++; return new Response('private conversation and provider detail', { status: 500 });
  } }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const legacy = await fetch(`${url}/pose?text=private-conversation`);
  assert.equal(legacy.status, 405); assert.equal(legacy.headers.get('allow'), 'POST');
  assert.equal(legacy.headers.get('cache-control'), 'no-store'); assert.equal(calls, 0);
  const post = body => fetch(`${url}/pose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const invalid = await post({ text: 'test', spoken: 'invalid-language' });
  assert.equal(invalid.status, 400); assert.equal(calls, 0);
  const response = await post({ text: 'private conversation' });
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('private conversation'), false);
  assert.deepEqual(logs, [{ event: 'avatar_provider_failed', code: 500 }]);
});
