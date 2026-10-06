const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createConnectionAdmission } = require('../server/connectionAdmission');

function fixture(options = {}) {
  let sequence = 0;
  const timers = new Map();
  const events = [];
  const admit = createConnectionAdmission({ maxConnections: 2, unjoinedTimeoutMs: 30000,
    setTimer: callback => { const id = ++sequence; timers.set(id, callback); return id; },
    clearTimer: id => timers.delete(id), telemetry: { record: event => events.push(event) }, ...options });
  const socket = id => {
    const value = new EventEmitter(); value.id = id; value.conn = new EventEmitter();
    value.disconnect = () => { value.closed = true; value.emit('disconnect'); value.conn.emit('close'); };
    value.conn.close = () => value.disconnect();
    return value;
  };
  const connect = value => { let error; admit(value, result => { error = result; }); return error; };
  const fire = () => { const [id, callback] = timers.entries().next().value; timers.delete(id); callback(); };
  return { timers, events, socket, connect, fire };
}

test('connection reservations bound concurrent middleware admission before namespace registration', () => {
  const f = fixture(); const a = f.socket('a'); const b = f.socket('b');
  assert.equal(f.connect(a), undefined); assert.equal(f.connect(b), undefined);
  assert.equal(f.connect(f.socket('c')).data.code, 'server_busy');
  assert.equal(f.timers.size, 2);
  a.conn.emit('close'); // No namespace disconnect occurs if the transport closes in middleware.
  assert.equal(f.connect(f.socket('replacement')), undefined);
  assert.equal(a.listenerCount('disconnect'), 0);
  assert.equal(a.conn.listenerCount('close'), 0);
});

test('unjoined timeout retains admitted calls and closes abandoned connections after departure', () => {
  const f = fixture(); const a = f.socket('a'); const b = f.socket('b');
  f.connect(a); f.connect(b); a.room = 'call:ABCD';
  f.fire(); assert.equal(a.closed, undefined);
  f.fire(); assert.equal(b.closed, true);
  assert.equal(f.timers.size, 1);
  delete a.room;
  f.fire(); assert.equal(a.closed, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.events, ['connection_idle_closed', 'connection_idle_closed']);
});

test('disconnect cancels admission timers and queued stale callbacks cannot close another socket', () => {
  const f = fixture(); const a = f.socket('a'); f.connect(a);
  const stale = [...f.timers.values()][0];
  a.emit('disconnect');
  assert.equal(f.timers.size, 0);
  const replacement = f.socket('a'); f.connect(replacement);
  stale(); assert.equal(replacement.closed, undefined);
  assert.equal(f.timers.size, 1);
});

test('draining rejects new connections without reserving resources', () => {
  const f = fixture({ isDraining: () => true });
  assert.equal(f.connect(f.socket('a')).data.code, 'server_busy');
  assert.equal(f.timers.size, 0);
});
