const { test, expect } = require('@playwright/test');
const { createApplication } = require('../../server');
const path = require('node:path');
const fs = require('node:fs');
let application;
let baseURL;
test.beforeAll(async () => {
  application = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false' } });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${application.server.address().port}`;
});
test.afterAll(async () => application.close());

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`busy server retries without losing drafts at ${viewport.width}px`, async ({ browser }, testInfo) => {
    const app = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false' } });
    let busy = true;
    app.io.use((_socket, next) => {
      if (!busy) return next();
      const error = new Error('Server is busy.'); error.data = { code: 'server_busy' }; next(error);
    });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${app.server.address().port}`;
    const context = await browser.newContext({ viewport });
    await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
    try {
      const speaker = await context.newPage();
      await speaker.goto(`${origin}/hearing.html?room=BUSYCALL`);
      await expect(speaker.locator('#status-text')).toHaveText('Calls are busy. Retrying… Your draft is saved here.');
      await speaker.locator('#replyText').fill('Draft preserved while server is busy');
      await expect(speaker.locator('#replySend')).toBeDisabled();
      await speaker.screenshot({ path: testInfo.outputPath('busy.png'), fullPage: true });
      expect(await speaker.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      busy = false;
      const peer = await context.newPage(); await peer.goto(`${origin}/deaf.html?room=BUSYCALL`);
      await expect(speaker.locator('#replyStatus')).toHaveText('Ready to send.', { timeout: 12000 });
      await expect(speaker.locator('#replyText')).toHaveValue('Draft preserved while server is busy');
      await speaker.locator('#replySend').click();
      await expect(peer.getByText('Draft preserved while server is busy', { exact: true })).toBeVisible();
    } finally { await context.close(); await app.close(); }
  });
}

async function pair(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  // Keep these tests independent of optional remote font/CDN availability.
  await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const a = await context.newPage(); const b = await context.newPage();
  const room = Math.random().toString(36).slice(2, 10).toUpperCase();
  await a.goto(`${baseURL}/deaf.html?room=${room}`);
  await b.goto(`${baseURL}/hearing.html?room=${room}`);
  await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
  await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
  return { context, a, b, errors, room };
}

test('two users connect with synthetic video and exchange literal text in both directions', async ({ browser }) => {
  const f = await pair(browser);
  try {
    await expect.poll(() => f.b.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect(f.b.locator('#stageWaiting')).toBeHidden();
    await expect(f.a.locator('#captionStatus')).toContainText('unavailable');
    await expect(f.a.locator('#avatarSection')).toBeHidden();
    await expect(f.a.locator('#replySpeak')).toBeDisabled();
    const text = '<img src=x onerror=alert(1)> مرحبا 👋';
    await f.a.locator('#replyText').fill(text);
    await f.a.locator('#replyText').press('Enter');
    await expect(f.b.locator('.conversation-text')).toHaveText(text);
    await expect(f.b.locator('#conversationLog img')).toHaveCount(0);
    await f.b.locator('#replyText').fill('Hello back!');
    await f.b.locator('#replySend').click();
    await expect(f.a.locator('.conversation-text').last()).toHaveText('Hello back!');
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('malformed signaling diagnostics omit peer payloads while the existing typed call stays usable', async ({ browser }) => {
  const f = await pair(browser); const diagnostics = [];
  f.b.on('console', message => diagnostics.push(message.text()));
  try {
    await expect.poll(() => f.b.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    const privateMarker = 'PRIVATE_SIGNALING_DIAGNOSTIC_SENTINEL';
    await f.a.evaluate(marker => window.socket.emit('signal:offer', {
      sdp: { type: 'offer', sdp: `v=0\r\n${marker}\r\n` },
    }), privateMarker);
    await expect.poll(() => diagnostics.some(line => line === 'Error handling remote offer.')).toBe(true);
    expect(diagnostics.some(line => line.includes(privateMarker))).toBe(false);
    await f.b.locator('#replyText').fill('Reply after malformed signaling'); await f.b.locator('#replySend').click();
    await expect(f.a.getByText('Reply after malformed signaling', { exact: true })).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('permission denial leaves typed replies usable', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=DENIED`);
    await b.goto(`${baseURL}/hearing.html?room=DENIED`);
    await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
    await a.locator('#replyText').fill('Camera access is optional for this reply.');
    await a.locator('#replySend').click();
    await expect(b.locator('.conversation-text')).toHaveText('Camera access is optional for this reply.');
  } finally { await context.close(); }
});

for (const width of [1440, 390]) {
  test(`permission retry recovers media and captions without losing a draft at ${width}px`, async ({ browser }, testInfo) => {
    const f = await captionApp();
    const pages = await captionPair(browser, f, () => {
      const media = navigator.mediaDevices;
      Object.defineProperty(navigator, 'mediaDevices', { value: media });
      const original = media.getUserMedia.bind(media);
      let allowed = false;
      window.allowCallMedia = () => { allowed = true; };
      Object.defineProperty(media, 'getUserMedia', { value: constraints => allowed ? original(constraints)
        : Promise.reject(new DOMException('Denied', 'NotAllowedError')) });
    });
    try {
      await pages.b.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect(pages.b.locator('#mediaStatus')).toContainText('access is blocked');
      await expect(pages.b.locator('#stageWaiting p')).toContainText('Peer video is unavailable');
      await expect(pages.b.locator('#retryMedia')).toBeEnabled();
      await pages.b.locator('#replyText').fill('My draft stays here during media recovery');
      if (width === 390) {
        const label = await pages.b.locator('#stageWaiting p').boundingBox();
        const preview = await pages.b.locator('.stage-pip').boundingBox();
        expect(label.x + label.width <= preview.x || label.y + label.height <= preview.y).toBe(true);
      }
      const socketId = await pages.b.evaluate(() => window.socket.id);
      await pages.b.screenshot({ path: testInfo.outputPath('media-denied.png'), fullPage: true });
      expect(await pages.b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await pages.b.evaluate(() => window.allowCallMedia());
      await pages.b.locator('#retryMedia').click();
      await expect(pages.b.locator('#mediaRecovery')).toBeHidden();
      if (await pages.b.locator('#captionAction').textContent() === 'Start captions') await pages.b.locator('#captionAction').click();
      await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
      await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
      await expect.poll(() => pages.a.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
      expect(await pages.b.evaluate(() => window.socket.id)).toBe(socketId);
      await expect(pages.b.locator('#replyText')).toHaveValue('My draft stays here during media recovery');
      await pages.b.locator('#replySend').click();
      await expect(pages.a.getByText('My draft stays here during media recovery', { exact: true })).toBeVisible();
      await pages.a.evaluate(() => window.allowCallMedia());
      await pages.a.locator('#retryMedia').click();
      await expect(pages.a.locator('#mediaRecovery')).toBeHidden();
      await expect.poll(() => pages.a.locator('#aslVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
      await expect(pages.a.locator('#stageWaiting')).toBeHidden();
      expect(await pages.a.evaluate(() => document.querySelector('#aslVideo').srcObject === document.querySelector('#localVideo').srcObject)).toBe(true);

      // stop() does not emit ended. Invoke the hardware-loss handler with an actually ended track;
      // Firefox does not deliver a script-dispatched ended event on this native target.
      await pages.b.locator('#toggleMic').click(); await pages.b.locator('#toggleCamera').click();
      await pages.b.evaluate(() => {
        window.oldCallTracks = document.querySelector('#localVideo').srcObject.getTracks();
        const track = window.oldCallTracks.find(track => track.kind === 'audio');
        const onEnded = track.onended; track.stop(); onEnded(new Event('ended'));
      });
      await expect(pages.b.locator('#mediaStatus')).toContainText('stopped');
      await pages.b.locator('#retryMedia').click();
      await expect(pages.b.locator('#mediaRecovery')).toBeHidden();
      expect(await pages.b.evaluate(() => window.oldCallTracks.every(track => track.readyState === 'ended'))).toBe(true);
      expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live' && !track.enabled))).toBe(true);
      await expect(pages.b.locator('#toggleMic')).toHaveAttribute('aria-pressed', 'false');
      await expect(pages.b.locator('#toggleCamera')).toHaveAttribute('aria-pressed', 'false');
      // Exactly one handler remains after multiple media acquisitions.
      await pages.b.locator('#toggleMic').click(); await pages.b.locator('#toggleCamera').click();
      expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.enabled))).toBe(true);
      expect(pages.errors).toEqual([]);
    } finally { await pages.context.close(); await f.app.close(); }
  });
}

test('unanswered media permission allows typed calls and late permission release is cleaned up', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const media = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: media });
    const original = media.getUserMedia.bind(media);
    Object.defineProperty(media, 'getUserMedia', { value: constraints => new Promise(resolve => {
      window.releasePermission = async () => {
        window.lateStream = await original(constraints); resolve(window.lateStream);
      };
    }) });
  });
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=PENDINGMEDIA`); await b.goto(`${baseURL}/hearing.html?room=PENDINGMEDIA`);
    await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect.poll(() => b.evaluate(() => typeof window.releasePermission)).toBe('function');
    expect(await b.locator('#localVideo').evaluate(video => video.srcObject)).toBeNull();
    await expect(b.locator('#retryMedia')).toBeDisabled();
    await a.locator('#replyText').fill('Text while permission waits'); await a.locator('#replySend').click();
    await expect(b.getByText('Text while permission waits', { exact: true })).toBeVisible();
    await b.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await b.evaluate(() => window.releasePermission());
    await expect.poll(() => b.evaluate(() => window.lateStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  } finally { await context.close(); }
});

for (const width of [1440, 390]) {
  test(`device selection replaces native call tracks and preserves drafts and mute choices at ${width}px`, async ({ browser }, testInfo) => {
    const f = await captionApp();
    const pages = await captionPair(browser, f, () => {
      const media = navigator.mediaDevices;
      // Keep the fixture on one native wrapper; WebKit may recreate the wrapper
      // between property reads during early document initialization.
      Object.defineProperty(navigator, 'mediaDevices', { value: media });
      const nativeMedia = media.getUserMedia.bind(media);
      window.testDevices = [
        { kind: 'videoinput', deviceId: 'desk-camera', label: 'Desk camera <img src=x>' },
        { kind: 'videoinput', deviceId: 'missing-camera', label: 'Disconnected camera' },
        { kind: 'audioinput', deviceId: 'desk-mic', label: 'Desk microphone' },
      ];
      Object.defineProperty(media, 'enumerateDevices', { value: async () => window.testDevices });
      Object.defineProperty(media, 'getUserMedia', { value: constraints => {
        window.requestedDevices = constraints;
        if (constraints.video?.deviceId?.exact === 'missing-camera') return Promise.reject(new DOMException('Missing', 'OverconstrainedError'));
        // Exercise real native streams and replacement; virtual test device IDs
        // are mapped to the browser's synthetic hardware after checking constraints.
        const audio = { ...constraints.audio }; delete audio.deviceId;
        return nativeMedia({ video: true, audio });
      } });
    });
    try {
      await pages.b.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await expect(pages.b.locator('#mediaRecovery')).toBeHidden();
      await pages.b.locator('#replyText').fill('Draft stays while changing devices');
      await pages.b.locator('#toggleMic').click(); await pages.b.locator('#toggleCamera').click();
      const socket = await pages.b.evaluate(() => window.socket.id);
      await pages.b.evaluate(() => { window.beforeDevices = document.querySelector('#localVideo').srcObject.getTracks(); });
      await pages.b.locator('#toggleDevices').click();
      await expect(pages.b.locator('#deviceSettings')).toBeVisible();
      await expect(pages.b.locator('#applyDevices')).toBeEnabled();
      await pages.b.locator('#cameraDevice').selectOption('desk-camera');
      await pages.b.locator('#microphoneDevice').selectOption('desk-mic');
      await expect(pages.b.locator('#deviceSettings img')).toHaveCount(0);
      await pages.b.locator('#applyDevices').click();
      await expect(pages.b.locator('#deviceStatus')).toHaveText('Your selected devices are in use.');
      expect(await pages.b.evaluate(() => ({ video: window.requestedDevices.video.deviceId.exact,
        audio: window.requestedDevices.audio.deviceId.exact }))).toEqual({ video: 'desk-camera', audio: 'desk-mic' });
      expect(await pages.b.evaluate(() => window.beforeDevices.every(track => track.readyState === 'ended'))).toBe(true);
      expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live' && !track.enabled))).toBe(true);
      expect(await pages.b.evaluate(() => window.socket.id)).toBe(socket);
      await expect(pages.b.locator('#replyText')).toHaveValue('Draft stays while changing devices');
      await pages.b.evaluate(() => { window.afterDevices = document.querySelector('#localVideo').srcObject; });
      await pages.b.locator('#cameraDevice').selectOption('missing-camera');
      await pages.b.locator('#applyDevices').click();
      await expect(pages.b.locator('#mediaStatus')).toContainText('selected camera or microphone is unavailable');
      expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject === window.afterDevices &&
        video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
      await pages.b.locator('#replySend').click();
      await expect(pages.a.getByText('Draft stays while changing devices', { exact: true })).toBeVisible();
      await pages.b.evaluate(() => {
        window.testDevices = window.testDevices.filter(device => device.deviceId !== 'missing-camera');
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      });
      await expect(pages.b.locator('#cameraDevice option:checked')).toHaveText('Selected device unavailable');
      await pages.b.locator('#cameraDevice').selectOption('');
      await pages.b.locator('#microphoneDevice').selectOption('');
      await pages.b.locator('#applyDevices').click();
      await expect(pages.b.locator('#mediaRecovery')).toBeHidden();
      await expect(pages.b.locator('#deviceStatus')).toHaveText('Your selected devices are in use.');
      await pages.b.locator('#toggleMic').click(); await pages.b.locator('#toggleCamera').click();
      if (await pages.b.locator('#captionAction').textContent() !== 'Pause captions') await pages.b.locator('#captionAction').click();
      await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
      await expect.poll(() => pages.a.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
      expect(await pages.b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await pages.b.evaluate(async () => {
        window.scrollTo(0, 0);
        await Promise.all([...document.querySelectorAll('video')].map(video => new Promise(resolve => {
          video.requestVideoFrameCallback(() => video.requestVideoFrameCallback(resolve));
        })));
      });
      await pages.b.screenshot({ path: testInfo.outputPath('devices.png'), fullPage: true });
      if (testInfo.project.name !== 'firefox' && testInfo.project.name !== 'webkit') {
        const directory = path.resolve(__dirname, '../../../.impeccable/review'); fs.mkdirSync(directory, { recursive: true });
        await pages.b.screenshot({ path: path.join(directory, `devices-${width === 390 ? 'mobile' : 'desktop'}.png`), fullPage: true });
      }
      await pages.b.locator('#microphoneDevice').press('Escape');
      await expect(pages.b.locator('#deviceSettings')).toBeHidden();
      await expect(pages.b.locator('#toggleDevices')).toBeFocused();
      await pages.a.locator('#toggleDevices').click(); await expect(pages.a.locator('#deviceSettings')).toBeVisible();
      await pages.a.locator('#closeDevices').click();
      expect(pages.errors).toEqual([]);
    } finally { await pages.context.close(); await f.app.close(); }
  });
}

test('device discovery timeout keeps text usable and stale discovery cannot replace a reopened list', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const media = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: media });
    let calls = 0;
    Object.defineProperty(media, 'enumerateDevices', { value: () => {
      calls++;
      if (calls === 1) return new Promise(resolve => { window.finishDiscovery = () => resolve([{ kind: 'videoinput', deviceId: 'stale', label: 'Old discovery' }]); });
      return Promise.resolve([{ kind: 'videoinput', deviceId: 'fresh', label: 'Current camera' }]);
    } });
  });
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=DEVICELIST`); await b.goto(`${baseURL}/hearing.html?room=DEVICELIST`);
    await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
    await a.locator('#toggleDevices').click();
    await expect(a.locator('#applyDevices')).toBeDisabled();
    await a.locator('#replyText').fill('Text while devices are unavailable'); await a.locator('#replySend').click();
    await expect(b.getByText('Text while devices are unavailable', { exact: true })).toBeVisible();
    await expect(a.locator('#deviceStatus')).toContainText('Device list unavailable', { timeout: 8000 });
    await expect(a.locator('#applyDevices')).toBeEnabled();
    await a.locator('#closeDevices').click(); await a.locator('#toggleDevices').click();
    await expect(a.locator('#cameraDevice option[value="fresh"]')).toHaveCount(1);
    await a.evaluate(() => window.finishDiscovery());
    await expect(a.locator('#cameraDevice option[value="fresh"]')).toHaveCount(1);
    await expect(a.locator('#cameraDevice option[value="stale"]')).toHaveCount(0);
  } finally { await context.close(); }
});

test('peer departure preserves drafts; a replacement peer can connect', async ({ browser }) => {
  const f = await pair(browser);
  try {
    await f.a.locator('#replyText').fill('Keep this draft');
    await f.b.close();
    await expect(f.a.locator('#replyStatus')).toContainText('Your peer left');
    await expect(f.a.locator('#replyText')).toHaveValue('Keep this draft');
    await expect(f.a.locator('#replySend')).toBeDisabled();
    const replacement = await f.context.newPage();
    await replacement.goto(`${baseURL}/hearing.html?room=${f.room}`);
    await expect(f.a.locator('#replySend')).toBeEnabled();
    await f.a.locator('#replySend').click();
    await expect(replacement.locator('.conversation-text')).toHaveText('Keep this draft');
    await expect.poll(() => replacement.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('a cached-page return readmits the call and retains drafts without duplicating device controls', async ({ browser }) => {
  const f = await pair(browser);
  try {
    await expect.poll(() => f.b.locator('#localVideo').evaluate(video => video.srcObject?.getTracks().length || 0)).toBe(2);
    await f.b.locator('#toggleMic').click(); await f.b.locator('#toggleCamera').click();
    await f.b.locator('#replyText').fill('Draft survives a cached-page return');
    const oldSocket = await f.b.evaluate(() => {
      window.beforeCachedReturn = document.querySelector('#localVideo').srcObject.getTracks();
      const id = window.socket.id;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      return id;
    });
    await expect.poll(() => f.b.evaluate(() => window.beforeCachedReturn.every(track => track.readyState === 'ended'))).toBe(true);
    await expect(f.a.locator('#replyStatus')).toContainText('Your peer left');
    await f.b.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(f.b.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(f.b.locator('#mediaRecovery')).toBeHidden();
    expect(await f.b.evaluate(() => window.socket.id)).not.toBe(oldSocket);
    await expect(f.b.locator('#replyText')).toHaveValue('Draft survives a cached-page return');
    expect(await f.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live' && !track.enabled))).toBe(true);
    await f.b.locator('#toggleMic').click(); await f.b.locator('#toggleCamera').click();
    expect(await f.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.enabled))).toBe(true);
    await f.b.locator('#toggleDevices').click(); await expect(f.b.locator('#deviceSettings')).toBeVisible();
    await expect(f.b.locator('#applyDevices')).toBeEnabled(); await f.b.locator('#closeDevices').click();
    await f.b.locator('#replySend').click();
    await expect(f.a.getByText('Draft survives a cached-page return', { exact: true })).toBeVisible();
    await expect(f.a.locator('.conversation-text').filter({ hasText: 'Draft survives a cached-page return' })).toHaveCount(1);
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('a grant from the retired page cannot replace media acquired after cached-page return', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const media = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', { value: media });
    const nativeMedia = media.getUserMedia.bind(media);
    let calls = 0;
    Object.defineProperty(media, 'getUserMedia', { value: constraints => {
      if (++calls > 1) return nativeMedia(constraints);
      return new Promise(resolve => { window.releaseRetiredPermission = async () => {
        window.retiredStream = await nativeMedia(constraints); resolve(window.retiredStream);
      }; });
    } });
  });
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=RETIREDMEDIA`); await b.goto(`${baseURL}/hearing.html?room=RETIREDMEDIA`);
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await b.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(b.locator('#mediaRecovery')).toBeHidden();
    const tracks = await b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    await b.evaluate(() => window.releaseRetiredPermission());
    await expect.poll(() => b.evaluate(() => window.retiredStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    expect(await b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(tracks);
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await b.locator('#replyText').fill('Fresh call after a late old grant'); await b.locator('#replySend').click();
    await expect(a.getByText('Fresh call after a late old grant', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('a stalled instance check is bounded and does not prevent a typed call', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route('**/instance-id', () => new Promise(() => {}));
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=INSTANCE`); await b.goto(`${baseURL}/hearing.html?room=INSTANCE`);
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.', { timeout: 10000 });
    await b.locator('#replyText').fill('Text despite a stalled instance check'); await b.locator('#replySend').click();
    await expect(a.getByText('Text despite a stalled instance check', { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('desktop and mobile replies fit the viewport with long content', async ({ browser }) => {
  const f = await pair(browser);
  const directory = path.resolve(__dirname, '../../../.impeccable/review');
  fs.mkdirSync(directory, { recursive: true });
  try {
    await f.a.locator('#replyText').fill('A'.repeat(1000));
    await f.a.locator('#replySend').click();
    await expect(f.b.locator('.conversation-text')).toHaveText('A'.repeat(1000));
    await expect(f.b.locator('#stageWaiting')).toBeHidden();
    await f.b.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true });
    for (const page of [f.a, f.b]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#replyText')).toBeVisible();
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits).toBe(true);
      for (const selector of ['#replyText', '#replySend', '.ctrl-leave', '.role-badge', '.stage-pip']) {
        const bounds = await page.locator(selector).boundingBox();
        expect(bounds.x, selector).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width, selector).toBeLessThanOrEqual(391);
      }
    }
    await f.a.locator('#replyText').fill('A clear reply, ready for review.');
    await f.b.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true });
    await f.a.screenshot({ path: path.join(directory, 'mobile-signing.png'), fullPage: true });
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('optional speech attaches native playback to a confirmed reply without autoplay', async ({ browser }) => {
  // A short synthetic WAV exercises browser decoding without any paid provider.
  const wav = Buffer.alloc(44 + 1600);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  const app = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' },
    speech: { bindSocketToStream() {}, processAudio() {}, cleanup() {} },
    synthesize: async () => wav.toString('base64') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const context = await browser.newContext();
  const a = await context.newPage(); const b = await context.newPage();
  const errors = []; a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
  try {
    await a.goto(`${url}/deaf.html?room=SPOKEN`); await b.goto(`${url}/hearing.html?room=SPOKEN`);
    await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
    await a.locator('#replyText').fill('Speak this reviewed reply.'); await a.locator('#replySpeak').check();
    await a.locator('#replySend').click();
    const audio = b.getByLabel('Listen to this reply');
    await expect(audio).toBeVisible();
    expect(await audio.evaluate(element => element.paused)).toBe(true);
    await audio.evaluate(element => element.play());
    await expect.poll(() => audio.evaluate(element => element.ended)).toBe(true);
    await expect(a.locator('#tandem-tts-toast')).toContainText('Spoken');
    expect(errors).toEqual([]);
  } finally { await context.close(); await app.close(); }
});

async function captionApp({ failProvider = false, maxSessionMs = 0, idleMs = 0, dailyBudget = null } = {}) {
  const { EventEmitter } = require('node:events');
  const { SpeechToTextService } = require('../../server/speechToText');
  const records = [];
  let failed = false;
  const client = { streamingRecognize() {
    const stream = new EventEmitter(); stream.writable = true; stream.bytes = 0; stream.chunks = 0;
    stream.destroy = () => { stream.destroyed = true; stream.emit('end'); };
    stream.write = buffer => {
      stream.bytes += buffer.length; stream.chunks++;
      if (stream.chunks === 1) queueMicrotask(() => {
        if (failProvider && !failed) {
          failed = true; const error = new Error('synthetic outage'); error.code = 14; stream.emit('error', error);
        } else stream.emit('data', { results: [{ isFinal: true, alternatives: [{ transcript: 'Synthetic caption result.' }] }] });
      });
      return true;
    };
    records.push(stream); return stream;
  } };
  const speech = new SpeechToTextService({ client, maxSessionMs, idleMs, dailyBudget });
  if (failProvider) speech.MAX_FAILURE_MS = 0;
  const app = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false', ENABLE_SPEECH: 'true' }, speech });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  return { app, records, speech, url: `http://127.0.0.1:${app.server.address().port}` };
}

async function captionPair(browser, f, script, { startCaptions = true } = {}) {
  const context = await browser.newContext();
  if (script) await context.addInitScript(script);
  const a = await context.newPage(); const b = await context.newPage();
  const errors = []; a.on('pageerror', error => errors.push(error.message)); b.on('pageerror', error => errors.push(error.message));
  await a.goto(`${f.url}/deaf.html?room=CAPTIONS`); await b.goto(`${f.url}/hearing.html?room=CAPTIONS`);
  await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
  // Admission deliberately precedes permission/capture setup. Wait for that
  // operation to settle before deciding whether audio needs a user gesture.
  for (const page of [a, b]) await expect(page.locator('#retryMedia')).toBeEnabled({ timeout: 15000 });
  if (startCaptions) for (const page of [a, b]) {
    const action = page.locator('#captionAction');
    if (await action.isVisible() && await action.textContent() === 'Start captions') {
      await action.click(); await expect(action).toBeEnabled();
    }
  }
  return { context, a, b, errors };
}

test('cloud captions require an explicit action while video and typed replies work beforehand', async ({ browser }, testInfo) => {
  const f = await captionApp(); const pages = await captionPair(browser, f, undefined, { startCaptions: false });
  try {
    for (const page of [pages.a, pages.b]) {
      await expect(page.locator('#captionAction')).toHaveText('Start captions');
      await expect(page.locator('#captionDisclosure')).toContainText('Google');
      await expect(page.locator('#captionStatus')).toContainText('Google');
    }
    await pages.b.locator('#replyText').fill('A call without cloud transcription'); await pages.b.locator('#replySend').click();
    await expect(pages.a.getByText('A call without cloud transcription', { exact: true })).toBeVisible();
    await expect.poll(() => pages.a.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(f.records.length).toBe(0);
    await expect(pages.b.locator('#captionOverlay')).toBeHidden();
    await expect(pages.b.locator('#localCaptionsSidebar')).toHaveText('Start captions to transcribe your speech.');
    for (const width of [1440, 390]) {
      await pages.b.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      expect(await pages.b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await pages.b.screenshot({ path: testInfo.outputPath(`caption-choice-${width}.png`), fullPage: true });
      const controls = await pages.b.locator('.caption-tools').boundingBox();
      const badge = await pages.b.locator('.role-badge').boundingBox();
      expect(controls.x + controls.width <= badge.x || badge.x + badge.width <= controls.x ||
        controls.y + controls.height <= badge.y || badge.y + badge.height <= controls.y).toBe(true);
    }
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.b.locator('#captionOverlay')).toBeVisible();
    await expect(pages.b.locator('#localCaptionsSidebar')).toHaveText('Synthetic caption result.');
    expect(f.records.length).toBe(1);
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions paused');
    await expect(pages.b.locator('#captionOverlay')).toBeHidden();
    await expect(pages.b.locator('#localCaptionsSidebar')).toHaveText('Your captions paused.');
    expect(f.records[0].destroyed).toBe(true);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('daily caption allowance retains video and text, rejects repeated starts, and recovers on UTC rollover', async ({ browser }) => {
  const { createDailyCaptionBudget } = require('../../server/captionBudget');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tandem-browser-budget-'));
  const file = path.join(directory, 'ledger');
  let now = Date.parse('2026-10-07T23:59:00Z');
  fs.writeFileSync(file, JSON.stringify({ version: 1, day: '2026-10-07', reservedMs: 15000 }));
  const f = await captionApp({ dailyBudget: createDailyCaptionBudget({ file, limitSeconds: 15, now: () => now }) });
  const pages = await captionPair(browser, f);
  try {
    for (const page of [pages.a, pages.b]) {
      if (await page.locator('#captionAction').textContent() === 'Start captions') await page.locator('#captionAction').click();
      await expect(page.locator('#captionStatus')).toHaveText('Daily caption allowance reached · type a reply');
      await expect(page.locator('#captionAction')).toHaveText('Check captions');
    }
    const tracks = await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    await pages.b.locator('#captionAction').click();
    // The old paused label remains while the asynchronous Start acknowledgement
    // is pending. Wait for the new attempt to finish before moving the clock.
    await expect(pages.b.locator('#captionAction')).toBeEnabled();
    await expect(pages.b.locator('#captionAction')).toHaveText('Check captions');
    await expect(pages.b.locator('#captionStatus')).toHaveText('Daily caption allowance reached · type a reply');
    expect(f.records.length).toBe(0);
    await pages.b.locator('#replyText').fill('Text after the daily allowance'); await pages.b.locator('#replySend').click();
    await expect(pages.a.getByText('Text after the daily allowance', { exact: true })).toBeVisible();
    now = Date.parse('2026-10-08T00:00:00Z');
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    expect(f.records.length).toBe(1);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(tracks);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('cached caption call preserves an explicit pause and resumes fresh native capture', async ({ browser }) => {
  const f = await captionApp(); const pages = await captionPair(browser, f);
  try {
    if (await pages.a.locator('#captionAction').textContent() === 'Start captions') await pages.a.locator('#captionAction').click();
    await expect(pages.a.locator('#captionStatus')).toHaveText('Your captions on');
    await pages.a.locator('#captionAction').click();
    await expect(pages.a.locator('#captionStatus')).toHaveText('Your captions paused');
    await pages.a.locator('#replyText').fill('Paused-caption draft stays here');
    await pages.a.evaluate(() => {
      window.beforeCachedCaption = document.querySelector('#localVideo').srcObject.getTracks();
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(pages.a.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(pages.a.locator('#mediaRecovery')).toBeHidden();
    await expect(pages.a.locator('#captionStatus')).toHaveText('Your captions paused');
    await expect(pages.a.locator('#replyText')).toHaveValue('Paused-caption draft stays here');
    expect(await pages.a.evaluate(() => window.beforeCachedCaption.every(track => track.readyState === 'ended'))).toBe(true);
    expect(await pages.a.evaluate(() => document.querySelector('#aslVideo').srcObject === document.querySelector('#localVideo').srcObject)).toBe(true);
    await pages.a.locator('#captionAction').click();
    await expect(pages.a.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.b.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    await expect(pages.b.locator('#remoteCaptions')).toHaveText('Synthetic caption result.');
    await pages.a.locator('#replySend').click();
    await expect(pages.b.getByText('Paused-caption draft stays here', { exact: true })).toBeVisible();
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('real AudioWorklet sends binary PCM, mute stops transmission, and unmute keeps video live', async ({ browser }) => {
  const f = await captionApp(); const pages = await captionPair(browser, f);
  try {
    if (await pages.b.locator('#captionAction').textContent() === 'Start captions') await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    await expect(pages.a.locator('#remoteCaptions')).toHaveText('Synthetic caption result.');
    await expect(pages.a.locator('.conversation-text')).toContainText(['Synthetic caption result.']);
    expect(f.records.some(stream => stream.bytes > 0 && stream.bytes % 2048 === 0)).toBe(true);
    await pages.b.locator('#toggleMic').click();
    await expect(pages.b.locator('#captionStatus')).toContainText('Microphone off');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    const bytes = f.records.reduce((sum, stream) => sum + stream.bytes, 0);
    // Other peer remains active; measure only this muted peer's recognizer after pause.
    const ownStreams = f.records.filter(stream => stream.destroyed);
    const ownBytes = ownStreams.reduce((sum, stream) => sum + stream.bytes, 0);
    await pages.b.waitForTimeout(180);
    expect(ownStreams.reduce((sum, stream) => sum + stream.bytes, 0)).toBe(ownBytes);
    expect(bytes).toBeGreaterThan(0);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getVideoTracks()[0].readyState)).toBe('live');
    await pages.b.locator('#toggleMic').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    const directory = path.resolve(__dirname, '../../../.impeccable/review');
    fs.mkdirSync(directory, { recursive: true });
    await pages.b.screenshot({ path: path.join(directory, 'captions-desktop.png'), fullPage: true });
    await pages.b.setViewportSize({ width: 390, height: 844 });
    await pages.b.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelectorAll('video').forEach(video => video.pause());
    });
    await pages.b.waitForTimeout(250);
    await pages.b.screenshot({ path: path.join(directory, 'captions-mobile.png'), fullPage: true, animations: 'disabled' });
    for (const selector of ['#captionAction', '#replyText', '#replySend', '.ctrl-leave']) {
      const bounds = await pages.b.locator(selector).boundingBox();
      expect(bounds.x, selector).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width, selector).toBeLessThanOrEqual(391);
    }
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('automatic caption limit pauses recognition while video and typed replies remain usable', async ({ browser }) => {
  const f = await captionApp({ maxSessionMs: 3000 }); const pages = await captionPair(browser, f);
  try {
    if (await pages.b.locator('#captionAction').textContent() === 'Start captions') await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    const tracks = await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions paused', { timeout: 8000 });
    await expect(pages.b.locator('#captionAction')).toHaveText('Start captions');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    await pages.b.locator('#replyText').fill('Text still works after caption limit');
    await pages.b.locator('#replySend').click();
    await expect(pages.a.getByText('Text still works after caption limit', { exact: true })).toBeVisible();
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(tracks);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('caption pause is independent of microphone and provider retry does not stop call tracks', async ({ browser }) => {
  const f = await captionApp({ failProvider: true }); const pages = await captionPair(browser, f);
  try {
    for (const page of [pages.a, pages.b]) {
      if (await page.locator('#captionAction').textContent() === 'Start captions') await page.locator('#captionAction').click();
    }
    await expect.poll(async () => (await Promise.all([pages.a, pages.b].map(page =>
      page.locator('#captionAction').textContent()))).includes('Retry captions')).toBe(true);
    const failed = await pages.a.locator('#captionAction').isVisible() && await pages.a.locator('#captionAction').textContent() === 'Retry captions'
      ? pages.a : pages.b;
    await expect(failed.locator('#captionAction')).toHaveText('Retry captions');
    await failed.locator('#captionAction').click();
    await expect(failed.locator('#captionStatus')).toHaveText('Your captions on');
    await failed.locator('#captionAction').click();
    await expect(failed.locator('#captionStatus')).toHaveText('Your captions paused');
    const video = failed === pages.a ? '#localVideo' : '#localVideo';
    expect(await failed.locator(video).evaluate(element => element.srcObject.getAudioTracks()[0].enabled)).toBe(true);
    expect(await failed.locator(video).evaluate(element => element.srcObject.getVideoTracks()[0].readyState)).toBe('live');
    await failed.locator('#captionAction').click();
    await expect(failed.locator('#captionStatus')).toHaveText('Your captions on');
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('worklet setup failure can retry while shared camera/microphone tracks stay live', async ({ browser }) => {
  const f = await captionApp();
  const pages = await captionPair(browser, f, () => {
    const Original = window.AudioWorkletNode; let once = false;
    window.AudioWorkletNode = new Proxy(Original, { construct(target, args) {
      if (!once) { once = true; throw new Error('synthetic worklet load failure'); }
      return Reflect.construct(target, args);
    } });
  });
  try {
    await expect(pages.b.locator('#captionAction')).toHaveText('Retry captions');
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('hung browser audio resume offers a retry without losing call tracks or typed replies', async ({ browser }) => {
  const f = await captionApp();
  const pages = await captionPair(browser, f, () => {
    window.captureContexts = [];
    const Constructor = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = new Proxy(Constructor, { construct(target, args) {
      const context = Reflect.construct(target, args); window.captureContexts.push(context); return context;
    } });
  });
  try {
    if (await pages.b.locator('#captionAction').textContent() === 'Start captions') await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions paused');
    const tracks = await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    await pages.b.evaluate(() => {
      const context = window.captureContexts.at(-1);
      window.restoreAudioResume = () => Object.defineProperty(context, 'resume', { value: original, configurable: true });
      const original = context.resume.bind(context);
      Object.defineProperty(context, 'resume', { value: () => new Promise(() => {}), configurable: true });
    });
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionAction')).toHaveText('Retry captions', { timeout: 8000 });
    await expect(pages.b.locator('#captionAction')).toBeEnabled();
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    await pages.b.locator('#replyText').fill('Text works while audio activation fails'); await pages.b.locator('#replySend').click();
    await expect(pages.a.getByText('Text works while audio activation fails', { exact: true })).toBeVisible();
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(tracks);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    await pages.b.evaluate(() => window.restoreAudioResume());
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('browser audio suspension pauses the recognizer and deliberate resume keeps call tracks', async ({ browser }) => {
  const f = await captionApp();
  const pages = await captionPair(browser, f, () => {
    window.captureContexts = [];
    const Constructor = window.AudioContext || window.webkitAudioContext;
    window.AudioContext = new Proxy(Constructor, { construct(target, args) {
      const context = Reflect.construct(target, args); window.captureContexts.push(context); return context;
    } });
  });
  try {
    if (await pages.b.locator('#captionAction').textContent() === 'Start captions') await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    const before = await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    await pages.b.evaluate(() => window.captureContexts.at(-1).suspend());
    await expect(pages.b.locator('#captionAction')).toHaveText('Start captions');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    expect(f.records.some(stream => stream.destroyed)).toBe(true);
    await pages.b.locator('#captionAction').click();
    await expect(pages.b.locator('#captionStatus')).toHaveText('Your captions on');
    await expect(pages.a.locator('#peerCaptionStatus')).toHaveText('Peer captions on');
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(before);
    expect(await pages.b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('a third browser receives an actionable full-room state and keeps its draft', async ({ browser }) => {
  const f = await pair(browser);
  try {
    const third = await f.context.newPage(); await third.goto(`${baseURL}/hearing.html?room=${f.room}`);
    await expect(third.locator('#replyStatus')).toContainText('already has two people');
    await third.locator('#replyText').fill('Keep this until a room is available');
    await expect(third.locator('#replySend')).toBeDisabled();
    await expect(third.locator('#replyText')).toHaveValue('Keep this until a room is available');
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('transport loss and reconnection preserve an edited draft and restore video', async ({ browser }) => {
  const f = await pair(browser);
  try {
    await f.a.locator('#replyText').fill('Draft survives a reconnect');
    const initialId = await f.a.evaluate(() => window.socket.id);
    await f.a.evaluate(() => window.socket.io.engine.close());
    await expect.poll(() => f.a.evaluate(() => window.socket.id)).not.toBe(initialId);
    await expect(f.a.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(f.a.locator('#replyText')).toHaveValue('Draft survives a reconnect');
    await expect(f.a.locator('#replySend')).toBeEnabled();
    await f.a.locator('#replySend').click();
    await expect(f.b.locator('.conversation-text')).toHaveText('Draft survives a reconnect');
    await expect.poll(() => f.b.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('unsupported capture still admits callers and exchanges typed replies', async ({ browser }) => {
  const f = await captionApp();
  const pages = await captionPair(browser, f, () => { window.AudioWorkletNode = undefined; });
  try {
    await expect(pages.a.locator('#captionStatus')).toContainText('unsupported');
    await expect(pages.a.locator('#captionAction')).toBeHidden();
    await pages.a.locator('#replyText').fill('Text works without worklet support.'); await pages.a.locator('#replySend').click();
    await expect(pages.b.locator('.conversation-text')).toHaveText('Text works without worklet support.');
    expect(f.records.length).toBe(0);
    expect(pages.errors).toEqual([]);
  } finally { await pages.context.close(); await f.app.close(); }
});

test('server restart preserves page drafts, readmits callers, and restores video', async ({ browser }) => {
  const f = await pair(browser);
  const port = application.server.address().port;
  try {
    await f.a.locator('#replyText').fill('Draft survives a server restart');
    const before = await f.a.evaluate(() => window.socket.id);
    await application.close();
    application = createApplication({ env: { REQUIRE_ROOM_TOKEN: 'false' } });
    await new Promise(resolve => application.server.listen(port, '127.0.0.1', resolve));
    await expect.poll(() => f.a.evaluate(id => window.socket.connected && window.socket.id !== id, before)).toBe(true);
    await expect(f.a.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(f.a.locator('#replyText')).toHaveValue('Draft survives a server restart');
    await f.a.locator('#replySend').click();
    await expect(f.b.locator('.conversation-text')).toHaveText('Draft survives a server restart');
    await expect.poll(() => f.b.locator('#remoteVideo').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('short desktop sidebars can scroll the reply action into view', async ({ browser }) => {
  const f = await pair(browser, { viewport: { width: 1280, height: 720 } });
  try {
    await f.b.locator('#replyText').fill('A reply from a shorter screen.');
    await f.b.locator('#replySend').scrollIntoViewIfNeeded();
    const bounds = await f.b.locator('#replySend').boundingBox();
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
    await f.b.locator('#replySend').click();
    await expect(f.a.locator('.conversation-text')).toHaveText('A reply from a shorter screen.');
    expect(f.errors).toEqual([]);
  } finally { await f.context.close(); }
});

test('scheduled ICE renewal and simultaneous restart keep shared tracks and typed replies live', async ({ browser }) => {
  const context = await browser.newContext();
  await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  await context.route('**/ice-config', route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'X-Turn-Expires-At': String(Math.ceil(Date.now() / 1000) + 4) },
    body: JSON.stringify([{ urls: 'stun:stun.l.google.com:19302' }]) }));
  await context.addInitScript(() => {
    window.renewedConfigurations = 0;
    window.peerConnections = [];
    const original = RTCPeerConnection.prototype.setConfiguration;
    RTCPeerConnection.prototype.setConfiguration = function(config) {
      window.renewedConfigurations++; return original.call(this, config);
    };
    const Constructor = RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(Constructor, { construct(target, args) {
      const connection = Reflect.construct(target, args); window.peerConnections.push(connection); return connection;
    } });
  });
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const a = await context.newPage(); const b = await context.newPage();
  try {
    await a.goto(`${baseURL}/deaf.html?room=RENEWAL`); await b.goto(`${baseURL}/hearing.html?room=RENEWAL`);
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect.poll(() => b.evaluate(() => window.peerConnections.at(-1)?.connectionState)).toBe('connected');
    const before = await b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id));
    const ufrag = await b.evaluate(() => window.peerConnections.at(-1).localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1]);
    await expect.poll(() => b.evaluate(() => window.renewedConfigurations), { timeout: 10000 }).toBeGreaterThan(0);
    await expect.poll(() => b.evaluate(() => window.peerConnections.at(-1).localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1])).not.toBe(ufrag);
    const counts = await Promise.all([a.evaluate(() => window.renewedConfigurations), b.evaluate(() => window.renewedConfigurations)]);
    await Promise.all([a.evaluate(() => window.dispatchEvent(new Event('online'))), b.evaluate(() => window.dispatchEvent(new Event('online')))]);
    for (const [index, page] of [a, b].entries()) {
      await expect.poll(() => page.evaluate(() => window.renewedConfigurations)).toBeGreaterThan(counts[index]);
      await expect.poll(() => page.evaluate(() => window.peerConnections.at(-1).signalingState)).toBe('stable');
      await expect.poll(() => page.evaluate(() => window.peerConnections.at(-1).connectionState)).toBe('connected');
    }
    expect(await b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().map(track => track.id))).toEqual(before);
    expect(await b.locator('#localVideo').evaluate(video => video.srcObject.getTracks().every(track => track.readyState === 'live'))).toBe(true);
    await b.locator('#replyText').fill('Still connected after renewal'); await b.locator('#replySend').click();
    await expect(a.locator('.conversation-text')).toContainText(['Still connected after renewal']);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
