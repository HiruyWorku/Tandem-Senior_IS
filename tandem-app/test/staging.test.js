const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../deploy/staging/preflight.cjs');
const settings = { APP_HOST: 'tandem.example.com', ENABLE_SPEECH: 'false' };
const runtime = { ROOM_SIGNING_SECRET: 'a'.repeat(64), METRICS_TOKEN: 'b'.repeat(64), TURN_SHARED_SECRET: 'c'.repeat(64), TURN_URLS: 'turn:relay.example.com:3478' };
test('staging preflight accepts independent secrets and rejects placeholders, interpolation and unsafe origin', () => {
  assert.equal(validate(settings, runtime), true);
  for (const change of [{ ROOM_SIGNING_SECRET: 'REPLACE_WITH_INDEPENDENT_RANDOM_SECRET' },
    { METRICS_TOKEN: runtime.ROOM_SIGNING_SECRET }, { TURN_SHARED_SECRET: '$'.repeat(64) },
    { TURN_USERNAME: 'legacy' }, { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json' }, { TURN_URLS: '' }]) assert.throws(() => validate(settings, { ...runtime, ...change }));
  assert.throws(() => validate({ APP_HOST: 'https://example.com' }, runtime));
  for (const value of ['bad', '-1', '1', '86401']) assert.throws(() => validate({ ...settings, CAPTION_DAILY_SECONDS: value }, runtime));
  assert.equal(validate({ ...settings, CAPTION_DAILY_SECONDS: '0' }, runtime), true);
});

test('media capacity probe rejects unsafe targets/counts without leaking private arguments', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  for (const [origin, calls] of [['http://private-target.invalid/#invite=private', '1'],
    ['https://private-target.invalid/#invite=private', '0'], ['https://private-target.invalid', '11'],
    ['https://private-target.invalid', '1.5'], ['private invitation', '3']]) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../deploy/staging/media-capacity-smoke.cjs'), origin, calls], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { event: 'capacity_failed', reason: 'Media capacity verification failed', phase: 'configuration', readyCalls: 0 });
  }
});

test('caption probe rejects invalid targets and flags without exposing private invocation details', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  for (const args of [['http://private-target.invalid/#invite=private', 'private-audio.wav'],
    ['https://private-target.invalid/#invite=private', 'private-audio.wav', '--private-flag'],
    ['private invitation', 'private-audio.wav']]) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../deploy/staging/captions-smoke.cjs'), ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), { event: 'captions_failed', phase: 'configuration' });
  }
});

test('other live probes withhold private targets from failure diagnostics', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const expected = {
    'admission-smoke.cjs': JSON.stringify({ event: 'admission_failed', phase: 'configuration' }),
    'smoke.cjs': 'Core staging verification failed; private diagnostics withheld.',
    'relay-renewal-smoke.cjs': 'Relay verification failed; inspect the count-only report.',
  };
  for (const [script, message] of Object.entries(expected)) {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../deploy/staging', script),
      'http://private-target.invalid/#invite=private'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr.trim(), message);
  }
});
