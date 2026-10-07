const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('@playwright/test');

// Uses actual deployed expiry and relay allocations. Never print invitations or ICE credentials.
async function main() {
  const origin = new URL(process.argv[2]).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const context = await browser.newContext();
    await context.route('**/capabilities', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), captions: false, speechOutput: false } });
    });
    await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
    await context.addInitScript(() => {
      window.relayPeers = [];
      const Constructor = RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Constructor, { construct(target, args) {
        const peer = Reflect.construct(target, [{ ...args[0], iceTransportPolicy: 'relay' }]);
        window.relayPeers.push(peer); return peer;
      } });
    });
    const landing = await context.newPage(); await landing.goto(origin);
    await landing.waitForFunction(() => !document.querySelector('#copyLinkBtn').disabled);
    const pages = [await context.newPage(), await context.newPage()];
    const expiries = [[], []];
    const errors = [];
    pages.forEach((page, index) => {
      page.on('pageerror', () => errors.push(index));
      page.on('response', response => {
        if (new URL(response.url()).pathname !== '/ice-config' || response.status() !== 200) return;
        const expiry = Number(response.headers()['x-turn-expires-at']) * 1000;
        if (Number.isFinite(expiry) && expiry > Date.now()) expiries[index].push(expiry);
      });
    });
    await pages[0].goto(await landing.locator('#deafLink').getAttribute('href'));
    await pages[1].goto(await landing.locator('#hearingLink').getAttribute('href'));
    for (const page of pages) {
      await page.waitForFunction(() => document.querySelector('#replyStatus').textContent === 'Ready to send.');
      await page.waitForFunction(() => window.relayPeers.at(-1)?.connectionState === 'connected');
      await page.evaluate(async () => {
        const peer = window.relayPeers.at(-1);
        for (const sender of peer.getSenders()) {
          if (sender.track?.kind === 'audio') sender.track.enabled = false;
          if (sender.track?.kind !== 'video') continue;
          const parameters = sender.getParameters();
          for (const encoding of parameters.encodings) {
            encoding.maxBitrate = 24000; encoding.maxFramerate = 5; encoding.scaleResolutionDownBy = 4;
          }
          await sender.setParameters(parameters);
        }
      });
    }
    assert.ok(expiries.every(values => values.length));
    const originalExpiry = Math.max(...expiries.map(values => values[0]));
    const finishAt = originalExpiry + 45000;
    assert.ok(finishAt - Date.now() <= 4500000, 'Unexpected long credential TTL; aborting cost-bounded check');
    const started = Date.now();
    const originalTracks = await Promise.all(pages.map(page => page.locator('#localVideo').evaluate(video =>
      video.srcObject.getTracks().map(track => track.id))));
    const read = page => page.evaluate(async () => {
      const peer = window.relayPeers.at(-1); const stats = await peer.getStats();
      const values = [...stats.values()];
      const transport = values.find(item => item.type === 'transport' && item.selectedCandidatePairId);
      const pair = stats.get(transport?.selectedCandidatePairId) || values.find(item =>
        item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
      const video = values.filter(item => item.type === 'inbound-rtp' && (item.kind || item.mediaType) === 'video');
      const tracks = document.querySelector('#localVideo').srcObject.getTracks();
      return { state: peer.connectionState, local: stats.get(pair?.localCandidateId)?.candidateType,
        remote: stats.get(pair?.remoteCandidateId)?.candidateType,
        bytes: video.reduce((sum, item) => sum + (item.bytesReceived || 0), 0),
        frames: video.reduce((sum, item) => sum + (item.framesDecoded || 0), 0),
        tracks: tracks.map(track => track.id), live: tracks.every(track => track.readyState === 'live') };
    });
    let previous = await Promise.all(pages.map(read));
    let stalled = 0; let samples = 0;
    console.log(JSON.stringify({ event: 'started', secondsUntilExpiry: Math.ceil((originalExpiry - started) / 1000),
      captions: false, maxVideoBitratePerPeer: 24000 }));
    while (Date.now() < finishAt) {
      await delay(Math.min(30000, finishAt - Date.now()));
      const current = await Promise.all(pages.map(read));
      for (const [index, sample] of current.entries()) {
        assert.equal(sample.state, 'connected', 'Relay call disconnected');
        assert.equal(sample.local, 'relay'); assert.equal(sample.remote, 'relay');
        assert.deepEqual(sample.tracks, originalTracks[index]); assert.equal(sample.live, true);
      }
      const moving = current.every((sample, index) => sample.bytes > previous[index].bytes && sample.frames > previous[index].frames);
      stalled = moving ? 0 : stalled + 1;
      assert.ok(stalled < 2, 'Relay video stopped advancing for consecutive samples');
      const message = `Relay renewal check ${++samples}`;
      const sender = samples % 2; const receiver = 1 - sender;
      await pages[sender].locator('#replyText').fill(message); await pages[sender].locator('#replySend').click();
      await pages[receiver].getByText(message, { exact: true }).waitFor();
      assert.equal(errors.length, 0, 'Browser runtime error');
      console.log(JSON.stringify({ event: 'sample', elapsedSeconds: Math.round((Date.now() - started) / 1000),
        renewals: expiries.map(values => values.length - 1), videoAdvancing: moving,
        receivedBytes: current.map(sample => sample.bytes) }));
      previous = current;
    }
    assert.ok(expiries.every(values => values.length >= 2 && values.at(-1) > originalExpiry), 'Credentials did not extend');
    assert.equal(stalled, 0, 'Video did not advance after original credential expiry');
    console.log(JSON.stringify({ event: 'passed', elapsedSeconds: Math.round((Date.now() - started) / 1000),
      secondsPastOriginalExpiry: Math.round((Date.now() - originalExpiry) / 1000),
      renewals: expiries.map(values => values.length - 1), textChecks: samples }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
