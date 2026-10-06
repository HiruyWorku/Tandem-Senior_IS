const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

async function main() {
  const origin = new URL(process.argv[2]).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  for (const endpoint of ['/health', '/ready']) {
    assert.equal((await fetch(origin + endpoint)).status, 200);
  }
  assert.equal((await fetch(origin + '/metrics')).status, 404);
  assert.equal((await fetch(origin + '/ice-config')).status, 403);
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const context = await browser.newContext();
    // This check covers core calls/relay; keep synthetic microphones out of paid recognition.
    // captions-smoke.cjs separately validates the real provider.
    await context.route('**/capabilities', async route => {
      const response = await route.fetch();
      const capabilities = await response.json();
      await route.fulfill({ response, json: { ...capabilities, captions: false, speechOutput: false } });
    });
    const landing = await context.newPage();
    await landing.goto(origin);
    await landing.locator('#copyLinkBtn').waitFor({ state: 'visible' });
    await landing.waitForFunction(() => !document.querySelector('#copyLinkBtn').disabled);
    const token = new URLSearchParams(new URL(landing.url()).hash.slice(1)).get('invite');
    assert.ok(token);
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(await landing.locator('#deafLink').getAttribute('href'));
    await b.goto(await landing.locator('#hearingLink').getAttribute('href'));
    await b.waitForFunction(() => document.querySelector('#replyStatus').textContent === 'Ready to send.');
    await a.waitForFunction(() => document.querySelector('#replyStatus').textContent === 'Ready to send.');
    await a.locator('#replyText').fill('Staging connection check');
    await a.locator('#replySend').click();
    await b.getByText('Staging connection check', { exact: true }).waitFor();
    console.log('HTTPS, private invitation, WebSocket admission and typed reply passed.');
    const result = await landing.evaluate(async token => {
      const response = await fetch('/ice-config', { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('ICE configuration rejected');
      const iceServers = await response.json();
      const peers = [new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' }), new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' })];
      const candidates = [[], []];
      const errors = [];
      peers.forEach((peer, index) => {
        peer.onicecandidate = event => { if (event.candidate) candidates[index].push(event.candidate.type); };
        peer.onicecandidateerror = event => errors.push(event.errorCode);
      });
      const gather = peer => new Promise((resolve, reject) => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const timeout = setTimeout(() => reject(new Error('Relay gathering timed out')), 30000);
        peer.addEventListener('icegatheringstatechange', () => {
          if (peer.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
        });
      });
      try {
        const channel = peers[0].createDataChannel('staging-check');
        const delivered = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error(`Relay delivery timed out: ${JSON.stringify({ states: peers.map(p => p.iceConnectionState), candidates, errors })}`)), 60000);
          peers[1].ondatachannel = event => { event.channel.onmessage = message => { clearTimeout(timeout); resolve(message.data); }; };
          channel.onopen = () => channel.send('relay-ok');
        });
        await peers[0].setLocalDescription(await peers[0].createOffer());
        await gather(peers[0]);
        await peers[1].setRemoteDescription(peers[0].localDescription);
        await peers[1].setLocalDescription(await peers[1].createAnswer());
        await gather(peers[1]);
        await peers[0].setRemoteDescription(peers[1].localDescription);
        const message = await delivered;
        const stats = await peers[0].getStats();
        const pair = [...stats.values()].find(item => item.type === 'candidate-pair' && item.state === 'succeeded' && item.nominated);
        return { message, local: stats.get(pair?.localCandidateId)?.candidateType, remote: stats.get(pair?.remoteCandidateId)?.candidateType };
      } finally { peers.forEach(peer => peer.close()); }
    }, token);
    assert.deepEqual(result, { message: 'relay-ok', local: 'relay', remote: 'relay' });
    console.log('Forced TURN relay allocated and delivered data with temporary credentials.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
