const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('release audit, candidate validation, image rollback and failed recovery scenarios', () => {
  const result = spawnSync('python3', [path.join(__dirname, 'release_test.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
