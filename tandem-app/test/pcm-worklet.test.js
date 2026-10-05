const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function processor() {
  let registered;
  const sent = [];
  class Base {
    constructor() { this.port = { postMessage: data => sent.push(data) }; }
  }
  const context = vm.createContext({ AudioWorkletProcessor: Base, sampleRate: 16000,
    registerProcessor: (_name, Class) => { registered = Class; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/pcm-worklet.js'), 'utf8'), context);
  const node = new registered();
  return { node, sent, enabled: value => node.port.onmessage({ data: { type: 'enabled', value } }),
    feed: values => node.process([[Float32Array.from(values)]]) };
}

test('worklet encodes signed little-endian binary PCM and accepts changing render-block sizes', () => {
  const f = processor(); f.enabled(true);
  f.feed([-1, 0, 1, -2, 2, NaN, Infinity]);
  f.feed(Array(1017).fill(0.5));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].sampleRate, 16000);
  assert.equal(f.sent[0].buffer.byteLength, 2048);
  const bytes = Buffer.from(f.sent[0].buffer);
  assert.deepEqual([...bytes.subarray(0, 14)], [0, 128, 0, 0, 255, 127, 0, 128, 255, 127, 0, 0, 0, 0]);
  assert.equal(bytes.readInt16LE(14), 16384);
});

test('pause discards partial audio and does not post microphone data while disabled', () => {
  const f = processor();
  f.feed(Array(2048).fill(1)); assert.equal(f.sent.length, 0);
  f.enabled(true); f.feed(Array(500).fill(1));
  f.enabled(false); f.feed(Array(2048).fill(1));
  f.enabled(true); f.feed(Array(1024).fill(0));
  assert.equal(f.sent.length, 1);
  assert.equal(Buffer.from(f.sent[0].buffer).every(byte => byte === 0), true);
});

test('worklet never copies microphone input to its speaker output', () => {
  const f = processor(); f.enabled(true);
  const output = Float32Array.from([0, 0, 0]);
  assert.equal(f.node.process([[Float32Array.from([1, 1, 1])]], [[output]]), true);
  assert.deepEqual([...output], [0, 0, 0]);
});
