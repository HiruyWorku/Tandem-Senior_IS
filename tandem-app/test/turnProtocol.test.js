const { test } = require('node:test');
const assert = require('node:assert/strict');
const { message, parse, xorPeer } = require('../deploy/staging/turn-security-smoke.cjs');

test('TURN smoke authentication matches the RFC 5769 STUN integrity vector', () => {
  // Published short-term authentication vector; the same STUN integrity framing
  // is used with coturn's derived long-term key. Preserve published padding.
  const transaction = Buffer.from('b7e7a701bc34d686fa87dfae', 'hex');
  const attributes = ['802200105354554e207465737420636c69656e74', '002400046e0001ff',
    '80290008932ff9b151263b36', '000600096576746a3a68367659202020'].map(value => Buffer.from(value, 'hex'));
  const packet = message(1, attributes, Buffer.from('VOkJxbRl1RmTxUk/WvJxBt'), transaction);
  assert.equal(packet.subarray(-20).toString('hex'), '9aeaa70cbfd8cb56781ef2b5b2d3f249c1b571a2');
  assert.equal(packet.readUInt16BE(2), 0x50);
  assert.equal(parse(packet).attributes.get(0x0006).toString(), 'evtj:h6vY');
});

test('TURN smoke encodes XOR peers correctly and rejects truncated protocol responses', () => {
  const peer = xorPeer('169.254.169.254', 9);
  assert.equal(peer.toString('hex'), '001200080001211b88ec0dbc');
  const packet = message(0x0008, [peer]);
  assert.equal(parse(packet).type, 0x0008);
  assert.throws(() => parse(packet.subarray(0, -1)), /Truncated/);
  const corrupt = Buffer.from(packet); corrupt.writeUInt16BE(0x100, 22);
  assert.throws(() => parse(corrupt), /Truncated/);
  assert.throws(() => xorPeer('169.254.999.1'));
});
