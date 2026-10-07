const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const tls = require('node:tls');

const COOKIE = 0x2112a442;
function attribute(type, value) {
  const buffer = Buffer.alloc(4 + Math.ceil(value.length / 4) * 4);
  buffer.writeUInt16BE(type); buffer.writeUInt16BE(value.length, 2); value.copy(buffer, 4);
  return buffer;
}
function message(type, attributes, key, transaction = crypto.randomBytes(12)) {
  const body = Buffer.concat(attributes); const header = Buffer.alloc(20);
  header.writeUInt16BE(type); header.writeUInt16BE(body.length + (key ? 24 : 0), 2);
  header.writeUInt32BE(COOKIE, 4); transaction.copy(header, 8);
  const signed = Buffer.concat([header, body]);
  return key ? Buffer.concat([signed, attribute(0x0008, crypto.createHmac('sha1', key).update(signed).digest())]) : signed;
}
function parse(buffer) {
  assert.ok(buffer.length >= 20 && buffer.readUInt32BE(4) === COOKIE, 'Invalid STUN response');
  const end = 20 + buffer.readUInt16BE(2); assert.equal(buffer.length, end, 'Truncated STUN response');
  const attributes = new Map();
  for (let position = 20; position < end;) {
    assert.ok(position + 4 <= end, 'Truncated STUN attribute');
    const type = buffer.readUInt16BE(position); const length = buffer.readUInt16BE(position + 2);
    assert.ok(position + 4 + length <= end, 'Truncated STUN attribute value');
    attributes.set(type, buffer.subarray(position + 4, position + 4 + length));
    position += 4 + Math.ceil(length / 4) * 4;
  }
  const error = attributes.get(0x0009);
  return { type: buffer.readUInt16BE(0), attributes,
    error: error?.length >= 4 ? (error[2] & 7) * 100 + error[3] : null };
}
function xorPeer(address, port = 9) {
  const octets = address.split('.').map(Number);
  assert.ok(octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
  const buffer = Buffer.alloc(8); buffer[1] = 1; buffer.writeUInt16BE(port ^ (COOKIE >>> 16), 2);
  const cookie = Buffer.alloc(4); cookie.writeUInt32BE(COOKIE);
  octets.forEach((value, index) => { buffer[index + 4] = value ^ cookie[index]; });
  return attribute(0x0012, buffer);
}
class TurnConnection {
  async connect(host, port) {
    this.buffer = Buffer.alloc(0); this.requests = new Map();
    this.socket = tls.connect({ host, port, servername: host });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 20) {
        const length = 20 + this.buffer.readUInt16BE(2);
        if (this.buffer.length < length) break;
        const packet = this.buffer.subarray(0, length); this.buffer = this.buffer.subarray(length);
        const pending = this.requests.get(packet.subarray(8, 20).toString('hex'));
        if (pending) { this.requests.delete(packet.subarray(8, 20).toString('hex')); pending.resolve(packet); }
      }
    });
    this.socket.on('error', () => this.fail()); this.socket.on('close', () => this.fail());
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.destroy(); reject(new Error('TURN TLS connection timed out')); }, 10000);
      this.socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
      this.socket.once('error', () => { clearTimeout(timer); reject(new Error('TURN TLS trust or connection check failed')); });
    });
  }
  fail() {
    for (const request of this.requests.values()) request.reject(new Error('TURN TLS connection closed'));
    this.requests.clear();
  }
  async request(type, attributes, key) {
    const packet = message(type, attributes, key); const id = packet.subarray(8, 20).toString('hex');
    let timer;
    try {
      const reply = await new Promise((resolve, reject) => {
        this.requests.set(id, { resolve, reject });
        timer = setTimeout(() => { this.requests.delete(id); reject(new Error('TURN response timed out')); }, 5000);
        this.socket.write(packet);
      });
      return parse(reply);
    } finally { clearTimeout(timer); this.requests.delete(id); }
  }
  close() { this.socket?.destroy(); }
}

async function main() {
  const origin = new URL(process.argv[2]).origin; assert.equal(new URL(origin).protocol, 'https:');
  const room = await fetch(origin + '/api/rooms', { method: 'POST', signal: AbortSignal.timeout(10000) });
  assert.equal(room.status, 201, 'Invitation creation failed'); const invitation = await room.json();
  const response = await fetch(origin + '/ice-config', { headers: { Authorization: `Bearer ${invitation.token}` }, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, 'ICE configuration unavailable'); const servers = await response.json();
  const server = servers.find(server => [server.urls].flat().some(url => /^turns:[^:]+:443\?transport=tcp$/.test(url)));
  assert.ok(server, 'TURN TLS 443 is not configured');
  const url = [server.urls].flat().find(url => /^turns:[^:]+:443\?transport=tcp$/.test(url));
  const host = url.slice(6).split(':')[0];
  const key = crypto.createHash('md5');
  const connection = new TurnConnection();
  const transport = number => attribute(0x0019, Buffer.from([number, 0, 0, 0]));
  try {
    await connection.connect(host, 443);
    const challenge = await connection.request(0x0003, [transport(17)]);
    assert.equal(challenge.error, 401, 'Allocation did not require authentication');
    const realm = challenge.attributes.get(0x0014); const nonce = challenge.attributes.get(0x0015);
    assert.ok(realm && nonce, 'Missing TURN authentication challenge');
    const auth = [attribute(0x0006, Buffer.from(server.username)), attribute(0x0014, realm), attribute(0x0015, nonce)];
    const integrity = key.update(`${server.username}:${realm.toString()}:${server.credential}`).digest();
    const allocated = await connection.request(0x0003, [transport(17), ...auth], integrity);
    assert.equal(allocated.type, 0x0103, 'Authenticated UDP allocation failed');
    const publicPermission = await connection.request(0x0008, [xorPeer('34.30.255.171'), ...auth], integrity);
    assert.equal(publicPermission.type, 0x0108, 'Public relay peer permission failed');
    for (const address of ['169.254.169.254', '10.128.0.1', '127.0.0.1', '172.16.0.1', '192.168.0.1']) {
      const denied = await connection.request(0x0008, [xorPeer(address), ...auth], integrity);
      assert.equal(denied.error, 403, 'Private peer permission was not rejected');
    }
    console.log('Trusted TURN TLS, temporary authentication and public permission passed; five private peer permissions rejected.');
  } finally { connection.close(); }

  // A new TLS transport is needed: allocation properties cannot change in place.
  const tcp = new TurnConnection();
  try {
    await tcp.connect(host, 443);
    const challenge = await tcp.request(0x0003, [transport(6)]);
    // Some builds reject the unsupported transport before asking for credentials.
    if (challenge.error !== 442) {
      assert.equal(challenge.error, 401);
      const realm = challenge.attributes.get(0x0014); const nonce = challenge.attributes.get(0x0015);
      assert.ok(realm && nonce);
      const auth = [attribute(0x0006, Buffer.from(server.username)), attribute(0x0014, realm), attribute(0x0015, nonce)];
      const integrity = crypto.createHash('md5').update(`${server.username}:${realm.toString()}:${server.credential}`).digest();
      assert.equal((await tcp.request(0x0003, [transport(6), ...auth], integrity)).error, 442, 'TCP relay allocation was not rejected');
    }
    console.log('TCP relay allocations rejected; TCP/TLS client transport with UDP relay remains available.');
  } finally { tcp.close(); }
}
module.exports = { attribute, message, parse, xorPeer };
if (require.main === module) main().catch(() => { console.error('TURN security smoke failed; credentials and packet contents withheld.'); process.exitCode = 1; });
