const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDailyCaptionBudget } = require('../server/captionBudget');

function fixture(t, limitSeconds = 30) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-budget-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ledger.json');
  let now = Date.parse('2026-10-07T23:59:00Z');
  const create = () => createDailyCaptionBudget({ file, limitSeconds, now: () => now });
  return { directory, file, create, setNow: value => { now = Date.parse(value); } };
}

test('daily reservations persist across participants, service recreation and unused stream credit', t => {
  const f = fixture(t); const first = f.create();
  const a = first.open(); assert.equal(a.ok, true);
  assert.equal(a.lease.take(14000).ok, true);
  const b = f.create().open(); assert.equal(b.ok, true);
  assert.equal(f.create().open().reason, 'daily_budget');
  assert.equal(a.lease.take(1001).reason, 'daily_budget');
  assert.equal(b.lease.take(15000).ok, true);
  assert.equal(b.lease.take(1).reason, 'daily_budget');
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), { version: 1, day: '2026-10-07', reservedMs: 30000 });
});

test('UTC rollover charges existing streams to the new day and a backward clock cannot restore allowance', t => {
  const f = fixture(t, 15); const budget = f.create(); const a = budget.open();
  f.setNow('2026-10-08T00:00:00Z');
  assert.equal(a.lease.take(1).ok, true);
  assert.equal(f.create().open().reason, 'daily_budget');
  assert.equal(JSON.parse(fs.readFileSync(f.file)).day, '2026-10-08');
  f.setNow('2026-10-07T23:59:59Z');
  assert.equal(a.lease.take(1).reason, 'budget_unavailable');
});

test('corrupt, oversized, symlinked, missing-directory and locked ledgers fail closed', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, '{bad'); assert.equal(f.create().open().reason, 'budget_unavailable');
  fs.writeFileSync(f.file, 'x'.repeat(257)); assert.equal(f.create().open().reason, 'budget_unavailable');
  fs.unlinkSync(f.file); fs.symlinkSync(path.join(f.directory, 'missing'), f.file);
  assert.equal(f.create().open().reason, 'budget_unavailable'); fs.unlinkSync(f.file);
  fs.mkdirSync(f.file + '.lock'); assert.equal(f.create().open().reason, 'budget_unavailable');
  assert.equal(fs.existsSync(f.file + '.lock'), true, 'Another writer/stale lock must not be removed');
  const missing = createDailyCaptionBudget({ file: path.join(f.directory, 'absent', 'ledger'), limitSeconds: 15 });
  assert.equal(missing.open().reason, 'budget_unavailable');
});

test('removing a previously observed ledger cannot silently reset its allowance', t => {
  const f = fixture(t); const budget = f.create(); assert.equal(budget.open().ok, true);
  fs.unlinkSync(f.file); assert.equal(budget.open().reason, 'budget_unavailable');
  assert.equal(fs.existsSync(f.file), false);
});

test('daily caption settings reject ineffective limits and relative or absent persistence paths', () => {
  for (const options of [{ file: '/tmp/test', limitSeconds: 1 }, { file: 'relative', limitSeconds: 30 },
    { limitSeconds: 30 }, { file: '/tmp/test', limitSeconds: NaN }]) {
    assert.throws(() => createDailyCaptionBudget(options));
  }
});

test('aggregate snapshots distinguish uninitialized, exhausted and unavailable storage without resetting credit', t => {
  const f = fixture(t, 15); const b = f.create();
  assert.deepEqual(b.snapshot(), { available: true, limitSeconds: 15, reservedSeconds: 0, remainingSeconds: 15 });
  b.open();
  assert.deepEqual(b.snapshot(), { available: true, limitSeconds: 15, reservedSeconds: 15, remainingSeconds: 0 });
  assert.equal(b.open().reason, 'daily_budget');
  fs.writeFileSync(f.file, 'corrupt');
  assert.deepEqual(b.snapshot(), { available: false, limitSeconds: 15, remainingSeconds: 0 });
});
