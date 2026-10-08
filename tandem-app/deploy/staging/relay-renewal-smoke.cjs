const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const { videoAdvanced } = require('./relay-progress.cjs');

// Uses actual deployed expiry and relay allocations. Never print invitations or ICE credentials.
async function main() {
  const origin = new URL(process.argv[2]).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  const reportPath = process.argv[3];
  const restartCheck = process.argv.includes('--restart-check');
  const localClient = process.argv.includes('--local-client');
  assert.ok(!localClient || restartCheck, 'Local client overrides are only allowed in restart diagnostics');
  if (reportPath) fs.writeFileSync(reportPath, '', { flag: 'wx', mode: 0o600 });
  const report = value => {
    const line = JSON.stringify(value);
    console.log(line);
    if (reportPath) fs.appendFileSync(reportPath, `${line}\n`);
  };
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const context = await browser.newContext();
    if (localClient) await context.route('**/script.js', route => route.fulfill({ contentType: 'application/javascript',
      body: fs.readFileSync(require('node:path').join(__dirname, '../../public/script.js'), 'utf8') }));
    if (restartCheck) {
      // Exercise real credential replacement promptly without changing the server
      // TTL. This diagnostic does not establish continuity past actual expiry.
      const issued = new Set();
      await context.route('**/ice-config', async route => {
        const response = await route.fetch();
        const page = route.request().frame().page();
        const headers = response.headers();
        if (!issued.has(page)) {
          issued.add(page);
          headers['x-turn-expires-at'] = String(Math.floor(Date.now() / 1000) + 120);
        }
        await route.fulfill({ response, headers });
      });
    }
    await context.route('**/capabilities', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), captions: false, speechOutput: false } });
    });
    await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
    await context.addInitScript(() => {
      window.relayPeers = [];
      window.relayEvents = [];
      window.relayPresentedFrames = 0;
      window.addEventListener('DOMContentLoaded', () => {
        const video = document.querySelector('#remoteVideo');
        if (!video) return;
        const frame = () => { window.relayPresentedFrames++; video.requestVideoFrameCallback(frame); };
        video.requestVideoFrameCallback(frame);
      });
      for (const name of ['pagehide', 'pageshow', 'freeze', 'resume']) {
        window.addEventListener(name, event => window.relayEvents.push({ event: name,
          persisted: Boolean(event.persisted), at: Math.round(performance.now()) }));
      }
      document.addEventListener('visibilitychange', () => window.relayEvents.push({ event: 'visibility',
        state: document.visibilityState, at: Math.round(performance.now()) }));
      window.addEventListener('tandem:socket', event => {
        event.detail.on('connect', () => window.relayEvents.push({ event: 'socket_connected', at: Math.round(performance.now()) }));
        event.detail.on('disconnect', reason => window.relayEvents.push({ event: 'socket_disconnected',
          reason: ['transport close', 'transport error', 'ping timeout', 'io server disconnect', 'io client disconnect'].includes(reason) ? reason : 'other',
          at: Math.round(performance.now()) }));
      });
      const Constructor = RTCPeerConnection;
      window.RTCPeerConnection = new Proxy(Constructor, { construct(target, args) {
        const peer = Reflect.construct(target, [{ ...args[0], iceTransportPolicy: 'relay' }]);
        peer.addEventListener('track', event => window.relayEvents.push({ event: 'remote_track',
          kind: event.track.kind, streamVideos: event.streams[0]?.getVideoTracks().length || 0,
          streamAudios: event.streams[0]?.getAudioTracks().length || 0, at: Math.round(performance.now()) }));
        peer.addEventListener('connectionstatechange', () => window.relayEvents.push({ event: 'peer_state',
          state: peer.connectionState, at: Math.round(performance.now()) }));
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
      // Admission can now precede camera permission. Wait for negotiated media too.
      await page.waitForFunction(() => document.querySelector('#localVideo').srcObject?.getTracks().length &&
        document.querySelector('#localVideo').srcObject.getTracks().every(track => track.readyState === 'live'));
      await page.waitForFunction(() => document.querySelector('#remoteVideo').readyState >= 2);
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
      const element = document.querySelector('#remoteVideo');
      return { state: peer.connectionState, socketConnected: Boolean(window.socket?.connected),
        peerCount: window.relayPeers.length, events: window.relayEvents.splice(0),
        local: stats.get(pair?.localCandidateId)?.candidateType,
        remote: stats.get(pair?.remoteCandidateId)?.candidateType,
        bytes: video.reduce((sum, item) => sum + (item.bytesReceived || 0), 0),
        video: video.map(item => ({ id: item.id, bytes: item.bytesReceived || 0, frames: item.framesDecoded || 0 })),
        presentedFrames: window.relayPresentedFrames,
        playback: { paused: element.paused, readyState: element.readyState,
          tracks: element.srcObject?.getTracks().map(track => ({ kind: track.kind, muted: track.muted, live: track.readyState === 'live' })),
          receiverVideos: peer.getReceivers().filter(receiver => receiver.track.kind === 'video').map(receiver => ({
            displayed: element.srcObject?.getVideoTracks().includes(receiver.track), muted: receiver.track.muted,
            live: receiver.track.readyState === 'live' })) },
        tracks: tracks.map(track => track.id), live: tracks.every(track => track.readyState === 'live') };
    });
    let previous = await Promise.all(pages.map(read));
    const peerCounts = previous.map(sample => sample.peerCount);
    let stalled = 0; let samples = 0;
    report({ event: 'started', secondsUntilExpiry: Math.ceil((originalExpiry - started) / 1000),
      captions: false, maxVideoBitratePerPeer: 24000, diagnosticRestartOnly: restartCheck, localClient });
    while (Date.now() < finishAt) {
      await delay(Math.min(30000, finishAt - Date.now()));
      const current = await Promise.all(pages.map(read));
      report({ event: 'connections', elapsedSeconds: Math.round((Date.now() - started) / 1000),
        states: current.map(sample => sample.state), sockets: current.map(sample => sample.socketConnected),
        peerCounts: current.map(sample => sample.peerCount), events: current.map(sample => sample.events) });
      for (const [index, sample] of current.entries()) {
        assert.equal(sample.peerCount, peerCounts[index], 'Peer connection was replaced during the continuous relay check');
        assert.equal(sample.state, 'connected', 'Relay call disconnected');
        assert.equal(sample.local, 'relay'); assert.equal(sample.remote, 'relay');
        assert.deepEqual(sample.tracks, originalTracks[index]); assert.equal(sample.live, true);
      }
      const moving = current.every((sample, index) => videoAdvanced(sample, previous[index]));
      stalled = moving ? 0 : stalled + 1;
      report({ event: 'media', elapsedSeconds: Math.round((Date.now() - started) / 1000),
        videoAdvancing: moving, receivedBytes: current.map(sample => sample.bytes),
        presentedFrames: current.map(sample => sample.presentedFrames), reportCounts: current.map(sample => sample.video.length),
        playback: moving ? undefined : current.map(sample => sample.playback) });
      assert.ok(stalled < 2, 'Relay video stopped advancing for consecutive samples');
      const message = `Relay renewal check ${++samples}`;
      const sender = samples % 2; const receiver = 1 - sender;
      await pages[sender].locator('#replyText').fill(message); await pages[sender].locator('#replySend').click();
      await pages[receiver].getByText(message, { exact: true }).waitFor();
      assert.equal(errors.length, 0, 'Browser runtime error');
      report({ event: 'sample', elapsedSeconds: Math.round((Date.now() - started) / 1000),
        renewals: expiries.map(values => values.length - 1), videoAdvancing: moving,
        receivedBytes: current.map(sample => sample.bytes) });
      previous = current;
    }
    assert.ok(expiries.every(values => values.length >= 2 && values.at(-1) > originalExpiry), 'Credentials did not extend');
    assert.equal(stalled, 0, 'Video did not advance after original credential expiry');
    report({ event: 'passed', diagnosticRestartOnly: restartCheck, localClient, elapsedSeconds: Math.round((Date.now() - started) / 1000),
      secondsPastOriginalExpiry: Math.round((Date.now() - originalExpiry) / 1000),
      renewals: expiries.map(values => values.length - 1), textChecks: samples });
  } catch (error) {
    const reasons = ['Peer connection was replaced during the continuous relay check', 'Relay call disconnected',
      'Relay video stopped advancing for consecutive samples', 'Credentials did not extend',
      'Video did not advance after original credential expiry', 'Browser runtime error'];
    report({ event: 'failed', reason: reasons.find(reason => error.message.startsWith(reason)) || 'Relay verification failed' });
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => {
  // Playwright navigation call logs can contain the private invitation fragment.
  console.error(error.message.split('\n')[0].replace(/https?:\/\/\S+/g, '[staging URL]'));
  process.exitCode = 1;
});
