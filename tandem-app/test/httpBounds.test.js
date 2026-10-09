const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const { createApplication } = require('../server');

async function fixture(t) {
  const app = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false', MAX_CONNECTIONS: '2',
    MAX_HTTP_CONNECTIONS: '12', HTTP_HEADER_TIMEOUT_SECONDS: '2', HTTP_REQUEST_TIMEOUT_SECONDS: '3' } });
  const raw = [], callers = [];
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port, url = `http://127.0.0.1:${port}`;
  t.after(async () => { raw.forEach(socket => socket.destroy()); callers.forEach(socket => socket.disconnect()); await app.close(); });
  async function partial(text) {
    const socket = net.connect(port, '127.0.0.1'); raw.push(socket);
    let response = '';
    socket.on('data', bytes => { response += bytes.toString(); });
    socket.on('error', () => {});
    const closed = new Promise(resolve => socket.once('close', () => resolve(response)));
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    socket.write(text);
    return { socket, closed };
  }
  async function caller(userType) {
    const socket = connect(url, { transports: ['websocket'], reconnection: false }); callers.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    assert.equal((await ack(socket, 'join', { room: 'HTTPTEST', userType })).ok, true);
    return socket;
  }
  return { ...app, partial, caller, url };
}
const ack = (socket, event, body) => new Promise((resolve, reject) => socket.timeout(2000).emit(event, body,
  (error, result) => error ? reject(error) : resolve(result)));

test('raw HTTP capacity and header deadlines preserve admitted WebSocket callers', { timeout: 12000 }, async t => {
  const f = await fixture(t);
  const a = await f.caller('deaf'), b = await f.caller('hearing');
  const requests = [];
  for (let i = 0; i < 12; i++) requests.push(await f.partial('GET /health HTTP/1.1\r\nHost:'));
  const count = await new Promise((resolve, reject) => f.server.getConnections((error, value) => error ? reject(error) : resolve(value)));
  assert.equal(count, 12, 'Two admitted calls plus ten incomplete HTTP transports fill the cap');
  const responses = await Promise.all(requests.map(request => request.closed));
  assert.ok(responses.filter(body => body === '').length >= 2, 'Overflow transports are closed');
  assert.ok(responses.some(body => body.startsWith('HTTP/1.1 408')), 'Incomplete headers time out');
  assert.equal(a.connected, true); assert.equal(b.connected, true);
  const received = once(b, 'message:received', { signal: AbortSignal.timeout(2000) });
  const [result, [message]] = await Promise.all([
    ack(a, 'message:send', { id: 'after-http-pressure', text: 'Still connected' }), received,
  ]);
  assert.equal(result.ok, true); assert.equal(message.text, 'Still connected');
  assert.equal((await fetch(f.url + '/health')).status, 200);
});

test('incomplete HTTP bodies expire without requiring shutdown', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const request = await f.partial('POST /api/rooms HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{');
  assert.match(await request.closed, /^HTTP\/1\.1 408/);
  assert.equal((await fetch(f.url + '/ready')).status, 200);
});

test('transports that send no request bytes are reclaimed', { timeout: 6000 }, async t => {
  const f = await fixture(t);
  const request = await f.partial('');
  assert.match(await request.closed, /^HTTP\/1\.1 408/);
  assert.equal((await fetch(f.url + '/health')).status, 200);
});

test('HTTP transport configuration rejects unsafe capacities and deadlines', () => {
  for (const env of [{ MAX_HTTP_CONNECTIONS: '0' }, { MAX_CONNECTIONS: '2', MAX_HTTP_CONNECTIONS: '11' },
    { HTTP_HEADER_TIMEOUT_SECONDS: '0' }, { HTTP_REQUEST_TIMEOUT_SECONDS: 'NaN' },
    { HTTP_HEADER_TIMEOUT_SECONDS: '20', HTTP_REQUEST_TIMEOUT_SECONDS: '10' }]) {
    assert.throws(() => createApplication({ env }));
  }
});
