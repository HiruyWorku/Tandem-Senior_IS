const { test } = require('node:test');
const assert = require('node:assert/strict');
const { videoAdvanced } = require('../deploy/staging/relay-progress.cjs');
const sample = (id, bytes, frames, presentedFrames) => ({ video: [{ id, bytes, frames }], presentedFrames });
test('relay progress survives replaced RTP reports and disappearance of old reports', () => {
  const old = sample('old', 100000, 1000, 1000);
  const replaced = sample('new', 300, 3, 1003);
  assert.equal(videoAdvanced(replaced, old), true);
  assert.equal(videoAdvanced(sample('old', 300, 3, 1003), old), true);
  assert.equal(videoAdvanced(sample('old', 300, 3, 1000), old), false);
  const combined = { video: [...old.video, ...replaced.video], presentedFrames: 1003 };
  assert.equal(videoAdvanced(sample('new', 600, 6, 1006), combined), true);
});
test('relay progress requires received and presented video, rejecting a frozen decoder or transport', () => {
  const old = sample('current', 100, 1, 1);
  assert.equal(videoAdvanced(sample('current', 200, 2, 2), old), true);
  assert.equal(videoAdvanced(sample('current', 200, 2, 1), old), false);
  assert.equal(videoAdvanced(sample('current', 100, 1, 2), old), false);
  assert.equal(videoAdvanced({ video: [], presentedFrames: 2 }, old), false);
});
