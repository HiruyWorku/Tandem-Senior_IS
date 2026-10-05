const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCaptionRelay } = require('../server/captionRelay');

function fixture() {
  const sent = [];
  const timers = new Map();
  let id = 0;
  const socket = { connected: true, room: 'ABCD',
    to: room => ({ emit: (event, data) => sent.push({ room, event, data }) }) };
  const relay = createCaptionRelay(socket, {
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; },
    clearTimer: timer => timers.delete(timer),
  });
  return { relay, socket, sent, timers,
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(t => t.fn()); } };
}

test('interim captions are immediate and final captions merge into one peer delivery', () => {
  const f = fixture();
  f.relay.accept({ transcript: 'Hello', isFinal: false });
  assert.equal(f.sent[0].data.isLocal, false);
  f.relay.accept({ transcript: 'Hello.', isFinal: true });
  f.relay.accept({ transcript: 'How are you?', isFinal: true });
  assert.equal(f.sent.length, 1);
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 600);
  f.flush();
  assert.deepEqual(f.sent[1], { room: 'ABCD', event: 'transcript', data: {
    transcript: 'Hello. How are you?', isFinal: true, isLocal: false,
  } });
});

test('buffered captions are discarded on disconnect or room change', () => {
  for (const change of [f => { f.socket.connected = false; }, f => { f.socket.room = 'EFGH'; }]) {
    const f = fixture();
    f.relay.accept({ transcript: 'Private conversation', isFinal: true });
    change(f);
    f.flush();
    assert.equal(f.sent.length, 0);
  }
});

test('disposal cancels pending deliveries and ignores late provider results', () => {
  const f = fixture();
  f.relay.accept({ transcript: 'Hello', isFinal: true });
  const callback = [...f.timers.values()][0].fn;
  f.relay.dispose();
  callback();
  f.relay.accept({ transcript: 'late', isFinal: false });
  assert.equal(f.timers.size, 0);
  assert.equal(f.sent.length, 0);
});

test('participants outside a room cannot forward captions', () => {
  const f = fixture();
  f.socket.room = undefined;
  f.relay.accept({ transcript: 'Hello', isFinal: false });
  f.relay.accept({ transcript: 'Hello', isFinal: true });
  assert.equal(f.sent.length, 0);
  assert.equal(f.timers.size, 0);
});
