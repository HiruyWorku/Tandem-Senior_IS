const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const origin = new URL(process.argv[2]).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  const sample = path.resolve(process.argv[3]);
  const checkRotation = process.argv.slice(4).includes('--rotation');
  const checkRecovery = process.argv.slice(4).includes('--recovery');
  const checkLimits = process.argv.slice(4).includes('--limits');
  const capabilities = await (await fetch(origin + '/capabilities')).json();
  assert.equal(capabilities.captions, true);
  assert.equal(capabilities.speechOutput, false);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${sample}`,
  ] });
  try {
    const context = await browser.newContext();
    const landing = await context.newPage();
    await landing.goto(origin);
    await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
    const receiver = await context.newPage();
    const speakerContext = await browser.newContext();
    const speaker = await speakerContext.newPage();
    await receiver.addInitScript(() => {
      window.peerFinalCount = 0;
      window.addEventListener('tandem:socket', event => event.detail.on('transcript', data => {
        if (data.isFinal && data.isLocal === false) window.peerFinalCount++;
      }));
    });
    // One paid microphone is sufficient to prove peer delivery and rotation.
    await receiver.route('**/capabilities', async route => {
      const response = await route.fetch();
      const capabilities = await response.json();
      await route.fulfill({ response, json: { ...capabilities, captions: false, speechOutput: false } });
    });
    await speaker.addInitScript(() => {
      const monitor = window.captionCheck = { starts: [], finals: 0, finalGeneration: 0, failures: 0, lastFinalAt: null, maxFinalGapMs: 0, reason: null };
      window.addEventListener('tandem:socket', event => {
        event.detail.on('captionStatus', data => {
          monitor.reason = data.reason || null;
          if (data.status === 'starting') monitor.starts.push(performance.now());
          if (['unavailable', 'reconnecting'].includes(data.status)) monitor.failures++;
        });
        event.detail.on('transcript', data => {
          if (!data.isFinal) return;
          const now = performance.now();
          if (monitor.lastFinalAt !== null) monitor.maxFinalGapMs = Math.max(monitor.maxFinalGapMs, now - monitor.lastFinalAt);
          monitor.lastFinalAt = now;
          monitor.finals++;
          monitor.finalGeneration = monitor.starts.length;
        });
      });
    });
    await receiver.goto(await landing.locator('#deafLink').getAttribute('href'));
    await speaker.goto(await landing.locator('#hearingLink').getAttribute('href'));
    await expect(speaker.locator('#replyStatus')).toHaveText('Ready to send.');
    if (await speaker.locator('#captionAction').textContent() === 'Start captions') await speaker.locator('#captionAction').click();
    await expect(speaker.locator('#captionStatus')).toHaveText('Your captions on', { timeout: 30000 });
    await expect(receiver.locator('#remoteCaptions')).toContainText(/Brooklyn/i, { timeout: 30000 });
    await expect(receiver.locator('.conversation-text').filter({ hasText: /Brooklyn/i }).first()).toBeVisible({ timeout: 15000 });
    console.log('Real Google streaming transcription passed through browser AudioWorklet, Socket.IO and peer final-caption delivery.');
    if (checkRotation) {
      console.log('Checking the scheduled 270-second recognition rotation using one microphone.');
      const deadline = Date.now() + 330000;
      let stats;
      while (Date.now() < deadline) {
        stats = await speaker.evaluate(() => ({ ...window.captionCheck }));
        assert.equal(stats.failures, 0, 'Provider interruption occurred during rotation check');
        if (stats.starts.length >= 2 && stats.finalGeneration >= 2) break;
        console.log(JSON.stringify({ phase: 'rotation-wait', finals: stats.finals, streamStarts: stats.starts.length }));
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
      assert.ok(stats.starts.length >= 2 && stats.finalGeneration >= 2, 'No final caption arrived after scheduled rotation');
      const rotationMs = stats.starts[1] - stats.starts[0];
      assert.ok(rotationMs >= 265000 && rotationMs <= 285000, 'Stream replacement did not match the scheduled rotation');
      await expect(receiver.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
      console.log(JSON.stringify({ phase: 'rotation-passed', rotationMs: Math.round(rotationMs), finals: stats.finals,
        maxFinalGapMs: Math.round(stats.maxFinalGapMs) }));
    }
    if (checkRecovery) {
      const original = await speaker.evaluate(() => ({ id: window.socket.id,
        tracks: document.querySelector('#localVideo').srcObject.getTracks().map(track => track.id) }));
      await speaker.locator('#replyText').fill('Draft retained through connection loss');
      await speakerContext.setOffline(true);
      // Offline emulation alone may leave an established WebSocket open.
      // Also drop that transport, then verify reconnection cannot succeed while offline.
      await speaker.evaluate(() => window.socket.io.engine.close());
      await expect.poll(() => speaker.evaluate(() => window.socket.connected)).toBe(false);
      await expect(speaker.locator('#replySend')).toBeDisabled();
      await new Promise(resolve => setTimeout(resolve, 5000));
      assert.equal(await speaker.evaluate(() => window.socket.connected), false);
      const before = await receiver.evaluate(() => window.peerFinalCount);
      await speakerContext.setOffline(false);
      await expect.poll(() => speaker.evaluate(id => window.socket.connected && window.socket.id !== id, original.id), { timeout: 30000 }).toBe(true);
      await expect(speaker.locator('#replyStatus')).toHaveText('Ready to send.', { timeout: 30000 });
      await expect(speaker.locator('#replyText')).toHaveValue('Draft retained through connection loss');
      await expect(speaker.locator('#captionStatus')).toHaveText('Your captions on', { timeout: 30000 });
      await expect.poll(() => receiver.evaluate(() => window.peerFinalCount), { timeout: 30000 }).toBeGreaterThan(before);
      const tracks = await speaker.evaluate(() => document.querySelector('#localVideo').srcObject.getTracks().map(track => ({ id: track.id, state: track.readyState })));
      assert.deepEqual(tracks.map(track => track.id), original.tracks);
      assert.ok(tracks.every(track => track.state === 'live'));
      await expect.poll(() => receiver.locator('#remoteVideo').evaluate(video => video.srcObject?.active && video.readyState >= 2), { timeout: 30000 }).toBe(true);
      await speaker.locator('#replySend').click();
      await expect(receiver.getByText('Draft retained through connection loss', { exact: true })).toBeVisible();
      console.log('Offline/transport interruption recovered: new socket, same live local tracks, peer video, fresh final captions and retained typed draft delivery.');
    }
    if (checkLimits) {
      await speaker.evaluate(() => {
        const socket = window.socket;
        const emit = socket.emit;
        window.dropCaptionPcm = true;
        socket.emit = function (event, ...args) {
          if (event === 'audioData' && window.dropCaptionPcm) { this.flags = {}; return this; }
          return emit.call(this, event, ...args);
        };
      });
      await expect(speaker.locator('#captionStatus')).toHaveText('Your captions paused', { timeout: 25000 });
      assert.equal(await speaker.evaluate(() => window.captionCheck.reason), 'idle');
      await expect(speaker.locator('#captionAction')).toHaveText('Start captions');
      await speaker.locator('#replyText').fill('Text survives automatic caption pause');
      await speaker.locator('#replySend').click();
      await expect(receiver.getByText('Text survives automatic caption pause', { exact: true })).toBeVisible();
      const before = await receiver.evaluate(() => window.peerFinalCount);
      await speaker.evaluate(() => { window.dropCaptionPcm = false; });
      await speaker.locator('#captionAction').click();
      await expect(speaker.locator('#captionStatus')).toHaveText('Your captions on', { timeout: 30000 });
      await expect.poll(() => receiver.evaluate(() => window.peerFinalCount), { timeout: 30000 }).toBeGreaterThan(before);
      console.log('Real-provider idle cutoff and deliberate caption restart passed; typed delivery remained available.');
    }
    await speaker.locator('#captionAction').click();
    await expect(speaker.locator('#captionStatus')).toHaveText('Your captions paused');
    await expect(receiver.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    console.log('Caption pause acknowledged locally and by the peer.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
