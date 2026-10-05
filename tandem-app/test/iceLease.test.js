const { test } = require('node:test');
const assert = require('node:assert/strict');
async function fixture(fetchConfig) {
  const { IceLease } = await import('../public/iceLease.mjs');
  const timers = new Map(); const renewed = []; const failures = [];
  let time = 0; let id = 0;
  const lease = new IceLease({ fetchConfig, now: () => time,
    onRenewed: servers => renewed.push(servers), onFailure: status => failures.push(status),
    setTimer: (callback, delay) => { timers.set(++id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  const fire = async () => { const [key, timer] = timers.entries().next().value; timers.delete(key); timer.callback(); await new Promise(resolve => setImmediate(resolve)); };
  return { lease, timers, renewed, failures, fire, setNow: value => { time = value; } };
}
const servers = [{ urls: 'stun:example.com' }];

test('ICE lease caches setup fetches and renews before expiry', async () => {
  let calls = 0;
  const f = await fixture(async () => ({ servers, expiresAt: ++calls * 300000 }));
  await f.lease.load(); await f.lease.load(); assert.equal(calls, 1);
  assert.equal([...f.timers.values()][0].delay, 240000);
  f.setNow(240000); await f.fire(); assert.equal(calls, 2);
  assert.equal(f.renewed.length, 1); assert.equal(f.lease.expiresAt, 600000);
  f.lease.stop(); assert.equal(f.timers.size, 0);
});

test('renewal retries transient failures with bounded backoff and preserves current ICE servers', async () => {
  let failing = false;
  const f = await fixture(async () => { if (failing) throw new Error('network'); return { servers, expiresAt: 300000 }; });
  await f.lease.load(); failing = true;
  await assert.rejects(f.lease.refresh()); assert.equal(f.lease.servers, servers);
  assert.equal([...f.timers.values()][0].delay, 1000);
  for (let index = 0; index < 4; index++) await f.fire();
  assert.equal(f.failures.at(-1).terminal, true); assert.equal(f.timers.size, 0);
  f.lease.stop();
});

test('forbidden renewal stops retries and repeated fixed expiry does not spin near invitation expiry', async () => {
  const f = await fixture(async () => ({ servers, expiresAt: 300000 }));
  await f.lease.load(); f.setNow(250000); await f.lease.refresh();
  assert.equal([...f.timers.values()][0].delay, 50000);
  f.setNow(300000); await f.fire(); assert.deepEqual(f.failures.at(-1), { terminal: true, expired: true });
  const error = new Error('forbidden'); error.status = 403;
  f.lease.fetchConfig = async () => { throw error; };
  await assert.rejects(f.lease.refresh()); assert.equal(f.timers.size, 0);
  f.lease.stop();
});

test('stopping a lease aborts in-flight work and discards late credential responses', async () => {
  let resolve; let signal;
  const f = await fixture(input => { signal = input; return new Promise(done => { resolve = done; }); });
  const pending = f.lease.load(); await Promise.resolve(); f.lease.stop(); assert.equal(signal.aborted, true);
  resolve({ servers, expiresAt: 300000 }); await pending;
  assert.equal(f.lease.servers, null); assert.equal(f.timers.size, 0); assert.equal(f.renewed.length, 0);
});
