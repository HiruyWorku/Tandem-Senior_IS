const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { RemotePlayback } = await import('../public/remotePlayback.mjs');
  let time = 0, frames = 0, bytes = 0, id = 'video', visible = true, played = 0, repairs = 0, stopped = 0;
  const tracks = [{ kind: 'video', readyState: 'live', muted: false, stop: () => stopped++ },
    { kind: 'audio', readyState: 'live', stop: () => stopped++ }];
  const callbacks = new Map(); let callbackId = 0;
  const timers = new Set();
  const video = { muted: false, volume: 0.4, srcObject: { getTracks: () => tracks },
    play: () => { played++; return Promise.resolve(); },
    requestVideoFrameCallback: callback => { callbacks.set(++callbackId, callback); return callbackId; },
    cancelVideoFrameCallback: value => callbacks.delete(value) };
  const connection = { connectionState: 'connected', getStats: async () => new Map([[id,
    { id, type: 'inbound-rtp', kind: 'video', framesDecoded: frames, bytesReceived: bytes }]]) };
  const playback = new RemotePlayback({ video, connection, now: () => time, isVisible: () => visible,
    makeStream: values => ({ getTracks: () => values }), onRepair: () => repairs++,
    setTimer: callback => { timers.add(callback); return callback; }, clearTimer: callback => timers.delete(callback) });
  return { video, connection, playback, tracks, timers, callbacks,
    update: values => { time = values.time ?? time; frames = values.frames ?? frames; bytes = values.bytes ?? bytes; id = values.id ?? id; visible = values.visible ?? visible; },
    present: () => { const [key, callback] = callbacks.entries().next().value; callbacks.delete(key); callback(); },
    counts: () => ({ played, repairs, stopped }) };
}

test('decoded video without presentation rebinds the same received tracks and preserves audio choice', async () => {
  const f = await fixture(); const original = f.video.srcObject;
  await f.playback.check(); f.update({ time: 3000, frames: 90 }); await f.playback.check();
  assert.notEqual(f.video.srcObject, original); assert.deepEqual(f.video.srcObject.getTracks(), f.tracks);
  assert.equal(f.video.muted, false); assert.equal(f.video.volume, 0.4);
  assert.deepEqual(f.counts(), { played: 1, repairs: 1, stopped: 0 });
  f.present(); f.update({ time: 4000, frames: 120 }); await f.playback.check();
  assert.equal(f.counts().repairs, 1); f.playback.dispose();
});

test('paused WebKit sink requires incoming video and cannot retry indefinitely on stale frame callbacks', async () => {
  const f = await fixture(); f.video.paused = true; f.video.readyState = 4;
  f.tracks[0].muted = true;
  await f.playback.check(); f.update({ time: 3000 }); await f.playback.check();
  assert.equal(f.counts().repairs, 0);
  for (const time of [4000, 7000, 10000]) {
    f.present(); f.update({ time, bytes: time }); await f.playback.check();
  }
  assert.equal(f.counts().repairs, 2); assert.equal(f.counts().stopped, 0);
  f.playback.dispose();
});

test('quiet decoders, replaced stats and hidden pages do not trigger playback repair', async () => {
  const f = await fixture(); f.update({ frames: 100 }); await f.playback.check();
  f.update({ time: 3000 }); await f.playback.check();
  f.update({ time: 4000, id: 'replacement', frames: 0 }); await f.playback.check();
  f.update({ time: 5000, frames: 30, visible: false }); await f.playback.check();
  assert.equal(f.counts().repairs, 0); f.playback.dispose();
});

test('rejected playback attempts stay bounded and disposal cancels frame callbacks and scheduled checks', async () => {
  const f = await fixture(); f.video.play = () => Promise.reject(new Error('private playback error'));
  await f.playback.check();
  for (const time of [3000, 6000, 9000, 12000]) { f.update({ time, frames: time }); await f.playback.check(); }
  assert.equal(f.counts().repairs, 2);
  f.playback.dispose(); assert.equal(f.callbacks.size, 0); assert.equal(f.timers.size, 0);
  await f.playback.check(); assert.equal(f.counts().repairs, 2);
});

test('late stats after page/connection disposal cannot rebind a video or schedule work', async () => {
  const f = await fixture(); await f.playback.check();
  let finish;
  f.connection.getStats = () => new Promise(resolve => { finish = resolve; });
  f.update({ time: 5000 }); const pending = f.playback.check();
  f.playback.dispose();
  finish(new Map([['video', { id: 'video', type: 'inbound-rtp', kind: 'video', framesDecoded: 100 }]]));
  await pending; assert.equal(f.counts().repairs, 0); assert.equal(f.callbacks.size, 0);
  assert.equal(f.timers.size, 0);
});
