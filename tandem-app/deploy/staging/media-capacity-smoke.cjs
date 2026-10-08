const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('@playwright/test');
let phase = 'configuration'; let readyCalls = 0;

// Opt-in live staging probe: bounded duration/bitrate, no cloud captions or speech.
// Invitations, URLs, credentials, SDP and conversation bodies never enter output.
async function main() {
  const origin = new URL(process.argv[2]).origin;
  const calls = Number(process.argv[3] || 3);
  assert.equal(new URL(origin).protocol, 'https:');
  assert.ok(Number.isInteger(calls) && calls >= 1 && calls <= 10);
  phase = 'browser';
  const browserOptions = { channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] };
  const browsers = [await chromium.launch(browserOptions)];
  const deadline = setTimeout(() => { browsers.forEach(browser => browser.close().catch(() => {})); }, 180000);
  const contexts = []; let errors = 0;
  let currentPages = [], setupStage = 'invitation';
  const httpFailures = { invitation: [], capabilities: [], ice: [] };
  try {
    const pairs = [];
    phase = 'setup';
    for (let index = 0; index < calls; index++) {
      currentPages = [];
      // A single Chromium process exhausted native synthetic capture after
      // sixteen microphones/cameras. Keep at most ten callers per process;
      // all twenty peer connections still load the same staging app/relay.
      if (index > 0 && index % 5 === 0) browsers.push(await chromium.launch(browserOptions));
      const context = await browsers.at(-1).newContext(); contexts.push(context);
      context.setDefaultTimeout(30000);
      context.on('page', page => page.on('pageerror', () => errors++));
      context.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).pathname === '/api/rooms')
          httpFailures.invitation.push(response.status());
      });
      await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
      await context.route('**/capabilities', async route => {
        try {
          const response = await route.fetch();
          if (!response.ok()) httpFailures.capabilities.push(response.status());
          await route.fulfill({ response, json: { ...await response.json(),
            captions: false, speechOutput: false, recognition: false, avatar: false } });
        } catch { errors++; await route.abort().catch(() => {}); }
      });
      // One TLS relay endpoint bounds allocations while testing the restrictive
      // network path; this does not establish every transport at full capacity.
      await context.route('**/ice-config', async route => {
        try {
          const response = await route.fetch();
          if (!response.ok()) httpFailures.ice.push(response.status());
          const servers = (await response.json()).map(server => ({ ...server,
            urls: [server.urls].flat().filter(url => url.startsWith('turns:') && url.endsWith('?transport=tcp')),
          })).filter(server => server.urls.length);
          assert.ok(servers.length, 'TLS relay is required');
          await route.fulfill({ response, json: servers });
        } catch { errors++; await route.abort().catch(() => {}); }
      });
      await context.addInitScript(() => {
        window.capacityPeers = []; window.capacityFrames = 0;
        window.addEventListener('DOMContentLoaded', () => {
          const video = document.querySelector('#remoteVideo');
          if (!video) return;
          const frame = () => { window.capacityFrames++; video.requestVideoFrameCallback(frame); };
          video.requestVideoFrameCallback(frame);
        });
        window.RTCPeerConnection = new Proxy(RTCPeerConnection, { construct(target, args) {
          const peer = Reflect.construct(target, [{ ...args[0], iceTransportPolicy: 'relay' }]);
          window.capacityPeers.push(peer); return peer;
        } });
      });
      setupStage = 'invitation';
      const landing = await context.newPage(); await landing.goto(origin);
      await landing.waitForFunction(() => document.querySelector('#copyLinkBtn')?.disabled === false);
      const links = await Promise.all(['#deafLink', '#hearingLink'].map(selector => landing.locator(selector).getAttribute('href')));
      const pages = [await context.newPage(), await context.newPage()];
      currentPages = pages; setupStage = 'navigation';
      await pages[0].goto(links[0]); await pages[1].goto(links[1]); await landing.close();
      for (const page of pages) {
        setupStage = 'connected_media';
        await page.waitForFunction(() => document.querySelector('#replyStatus').textContent === 'Ready to send.' &&
          window.capacityPeers.at(-1)?.connectionState === 'connected' &&
          document.querySelector('#localVideo').srcObject?.getVideoTracks().length && window.capacityFrames > 1);
        setupStage = 'bitrate';
        await page.evaluate(async () => {
          for (const sender of window.capacityPeers.at(-1).getSenders()) {
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
      pairs.push(pages);
      readyCalls = pairs.length;
    }
    const read = page => page.evaluate(async () => {
      const peer = window.capacityPeers.at(-1); const stats = await peer.getStats();
      const values = [...stats.values()];
      const transport = values.find(item => item.type === 'transport' && item.selectedCandidatePairId);
      const pair = stats.get(transport?.selectedCandidatePairId) || values.find(item =>
        item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
      return { connected: peer.connectionState === 'connected' && Boolean(window.socket?.connected),
        peers: window.capacityPeers.length, frames: window.capacityFrames,
        relay: stats.get(pair?.localCandidateId)?.candidateType === 'relay' &&
          stats.get(pair?.remoteCandidateId)?.candidateType === 'relay',
        live: document.querySelector('#localVideo').srcObject.getTracks().every(track => track.readyState === 'live') };
    });
    const pages = pairs.flat();
    let previous = await Promise.all(pages.map(read));
    console.log(JSON.stringify({ event: 'capacity_started', calls, peers: pages.length, browserProcesses: browsers.length, captions: false, maxVideoBitratePerPeer: 24000 }));
    for (let sample = 1; sample <= 3; sample++) {
      phase = 'media';
      await delay(10000);
      const current = await Promise.all(pages.map(read));
      assert.ok(current.every((value, index) => value.connected && value.relay && value.live &&
        value.peers === previous[index].peers && value.frames > previous[index].frames));
      // Every room exchanges both directions at each sample, without paid TTS.
      phase = 'text';
      for (const pair of pairs) for (let sender = 0; sender < 2; sender++) {
        const text = `Synthetic capacity check ${sample}-${sender}`;
        await pair[sender].locator('#replyText').fill(text); await pair[sender].locator('#replySend').click();
        await pair[1 - sender].getByText(text, { exact: true }).waitFor();
      }
      assert.equal(errors, 0);
      console.log(JSON.stringify({ event: 'capacity_sample', sample, movingPeers: current.length, textChecks: calls * 2 }));
      previous = current;
    }
    console.log(JSON.stringify({ event: 'capacity_passed', calls, peers: pages.length, browserProcesses: browsers.length, textChecks: calls * 6, samples: 3, tlsOnly: true }));
  } catch (error) {
    const pending = Promise.all(currentPages.map(page => page.evaluate(async () => {
      const peer = window.capacityPeers?.at(-1);
      const video = document.querySelector('#remoteVideo');
      const stats = peer ? [...(await peer.getStats()).values()] : [];
      return { socketConnected: Boolean(window.socket?.connected),
        connection: peer?.connectionState || 'missing', signaling: peer?.signalingState || 'missing',
        frames: window.capacityFrames || 0, paused: video?.paused ?? true, readyState: video?.readyState || 0,
        localVideoTracks: document.querySelector('#localVideo')?.srcObject?.getVideoTracks().length || 0,
        decoded: stats.filter(item => item.type === 'inbound-rtp' && (item.kind || item.mediaType) === 'video')
          .reduce((sum, item) => sum + (item.framesDecoded || 0), 0),
        relayCandidates: stats.filter(item => item.type === 'local-candidate' && item.candidateType === 'relay').length };
    }).catch(() => ({ unavailable: true }))));
    let timer;
    const playback = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve([{ unavailable: true }]), 2000); })]);
    clearTimeout(timer);
    console.log(JSON.stringify({ event: 'capacity_diagnostic', phase, setupStage, readyCalls, errors, httpFailures, playback }));
    throw error;
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await Promise.allSettled(browsers.map(browser => browser.close()));
    clearTimeout(deadline);
  }
}
main().catch(() => {
  // Playwright failure logs may contain private links. Emit no raw exception.
  console.error(JSON.stringify({ event: 'capacity_failed', reason: 'Media capacity verification failed', phase, readyCalls }));
  process.exitCode = 1;
});
