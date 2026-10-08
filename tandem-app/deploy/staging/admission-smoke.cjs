const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
let phase = 'configuration';

async function main() {
  const origin = process.argv[2];
  const capacity = Number(process.argv[3] || 20);
  assert.match(origin || '', /^https:\/\/[^/]+$/);
  assert.ok(Number.isInteger(capacity) && capacity >= 2 && capacity <= 100);
  phase = 'invitation';
  const response = await fetch(`${origin}/api/rooms`, { method: 'POST', signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 201);
  const invitation = await response.json();
  const clients = [];
  const deadline = setTimeout(() => clients.forEach(socket => socket.disconnect()), 120000);
  const connect = async () => {
    const socket = io(origin, { auth: { token: invitation.token }, transports: ['websocket'], reconnection: false, timeout: 10000 });
    clients.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  };
  const ack = (socket, event, data) => new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, data, (error, result) => error ? reject(error) : resolve(result));
  });
  const receive = (socket, event, timeout = 10000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Missing ${event}`)); }, timeout);
    const listener = data => { clearTimeout(timer); resolve(data); };
    socket.once(event, listener);
  });
  try {
    phase = 'capacity';
    const admitted = await Promise.all(Array.from({ length: capacity }, connect));
    for (const [index, socket] of admitted.slice(0, 2).entries()) {
      assert.equal((await ack(socket, 'join', { room: invitation.room, token: invitation.token,
        userType: index ? 'hearing' : 'deaf' })).ok, true);
    }
    await assert.rejects(connect());
    console.log('Configured connection capacity rejected an extra client; two callers joined.');
    phase = 'cleanup';
    await Promise.all(admitted.slice(2).map(socket => receive(socket, 'disconnect', 35000)));
    assert.ok(admitted[0].connected && admitted[1].connected);
    const delivered = receive(admitted[1], 'message:received');
    phase = 'text';
    const text = 'Typed delivery survives idle admission cleanup';
    assert.equal((await ack(admitted[0], 'message:send', { id: 'admission-check', text })).ok, true);
    assert.equal((await delivered).text, text);
    phase = 'replacement';
    const replacement = await connect();
    assert.ok(replacement.connected);
    console.log('Unjoined clients closed; active typed delivery and replacement admission passed. No microphone audio sent.');
  } finally { clearTimeout(deadline); clients.forEach(socket => socket.disconnect()); }
}

main().catch(() => { console.error(JSON.stringify({ event: 'admission_failed', phase })); process.exitCode = 1; });
