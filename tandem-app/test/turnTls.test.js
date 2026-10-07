const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('TURN TLS installation and certificate renewal verify activation and recover failures', () => {
  const result = spawnSync('python3', [path.join(__dirname, 'turn_tls_test.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
