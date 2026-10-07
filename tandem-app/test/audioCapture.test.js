const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture({ moduleLoad = async () => {}, close = async () => {} } = {}) {
  const { AudioCapture } = await import('../public/audioCapture.js');
  const originalWindow = global.window; const originalNode = global.AudioWorkletNode;
  const contexts = []; const states = []; const disconnected = []; const closedPorts = []; const messages = [];
  class Context {
    constructor() { this.state = 'running'; this.audioWorklet = { addModule: moduleLoad }; contexts.push(this); }
    createMediaStreamSource() { return { connect() {}, disconnect: () => disconnected.push('source') }; }
    async resume() { this.state = 'running'; }
    async close() { await close(); this.state = 'closed'; }
  }
  class Node {
    constructor() { this.port = { postMessage: message => messages.push(message), close: () => closedPorts.push(true) }; }
    connect() {}
    disconnect() { disconnected.push('node'); }
  }
  global.window = { AudioContext: Context, AudioWorkletNode: Node }; global.AudioWorkletNode = Node;
  let stoppedTracks = 0;
  const stream = { getTracks: () => [{ stop: () => stoppedTracks++ }] };
  const capture = new AudioCapture({ onAudio() {}, onState: state => states.push(state),
    setupTimeoutMs: 20, resumeTimeoutMs: 20, closeTimeoutMs: 20 });
  return { capture, contexts, states, stream, disconnected, closedPorts, messages,
    stopped: () => stoppedTracks,
    restore: async () => { await capture.close(); global.window = originalWindow; global.AudioWorkletNode = originalNode; } };
}

test('hung worklet loading expires and releases its context without stopping call-owned tracks', async () => {
  let moduleReady = false;
  const f = await fixture({ moduleLoad: () => moduleReady ? Promise.resolve() : new Promise(() => {}) });
  try {
    await assert.rejects(f.capture.start(f.stream), error => error.code === 'timeout');
    assert.equal(f.capture.context, null); assert.equal(f.capture.node, null);
    assert.equal(f.contexts[0].state, 'closed'); assert.equal(f.stopped(), 0);
    moduleReady = true;
    await f.capture.start(f.stream); assert.ok(f.capture.node);
  } finally { await f.restore(); }
});

test('hung audio resume and close remain bounded while the detached graph cannot capture', async () => {
  const f = await fixture({ close: () => new Promise(() => {}) });
  try {
    await f.capture.start(f.stream); f.capture.setEnabled(true);
    f.contexts[0].resume = () => new Promise(() => {});
    await assert.rejects(f.capture.resume(), error => error.code === 'timeout');
    await f.capture.close();
    assert.equal(f.capture.enabled, false); assert.equal(f.capture.context, null);
    assert.equal(f.capture.stream, null); assert.equal(f.capture.node, null);
    assert.deepEqual(f.disconnected, ['source', 'node']); assert.equal(f.closedPorts.length, 1);
    assert.equal(f.stopped(), 0);
  } finally { await f.restore(); }
});

test('late resume after cleanup cannot publish state from a retired audio context', async () => {
  const f = await fixture();
  try {
    await f.capture.start(f.stream);
    let finish; f.contexts[0].resume = () => new Promise(resolve => { finish = resolve; });
    const pending = f.capture.resume(); await f.capture.close();
    const states = [...f.states]; finish(); await pending;
    assert.deepEqual(f.states, states); assert.equal(f.capture.context, null);
    assert.equal(f.stopped(), 0);
  } finally { await f.restore(); }
});

test('a newer start supersedes a retry waiting for the old context to close', async () => {
  let finishClose;
  const f = await fixture({ close: () => new Promise(resolve => { finishClose = resolve; }) });
  try {
    await f.capture.start(f.stream);
    const older = f.capture.start(f.stream);
    await f.capture.start(f.stream);
    const active = f.capture.context;
    assert.equal(f.contexts.length, 2);
    finishClose(); await older;
    assert.equal(f.capture.context, active);
    assert.equal(f.contexts.length, 2);
    assert.equal(f.stopped(), 0);
  } finally { await f.restore(); }
});

test('early running state cannot consume the enable message before the worklet port exists', async () => {
  let finishModule;
  const f = await fixture({ moduleLoad: () => new Promise(resolve => { finishModule = resolve; }) });
  try {
    const starting = f.capture.start(f.stream);
    await Promise.resolve();
    f.capture.setEnabled(true);
    assert.equal(f.capture.enabled, false);
    finishModule(); await starting;
    f.capture.setEnabled(true);
    assert.equal(f.capture.enabled, true);
    assert.deepEqual(f.messages, [{ type: 'enabled', value: true }]);
  } finally { await f.restore(); }
});
