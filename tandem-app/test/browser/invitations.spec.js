const { test, expect } = require('@playwright/test');
const { createHmac } = require('node:crypto');
const { createApplication } = require('../../server');
const fs = require('node:fs');
const path = require('node:path');
const signingSecret = 'persistent-browser-fixture-secret-at-least-32-bytes';
async function fixture(browser) {
  let application = createApplication({ env: { ROOM_SIGNING_SECRET: signingSecret } });
  await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
  const port = application.server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return { url, context, errors,
    restart: async () => {
      await application.close();
      application = createApplication({ env: { ROOM_SIGNING_SECRET: signingSecret } });
      await new Promise(resolve => application.server.listen(port, '127.0.0.1', resolve));
    },
    close: async () => { await context.close(); await application.close(); },
  };
}

test('private landing shares full fragment invitation and both roles can exchange replies', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const landing = await f.context.newPage();
    await landing.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedLink = text; } } }));
    const urls = []; landing.on('request', request => urls.push(request.url()));
    await landing.goto(f.url);
    await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
    await expect(landing.locator('#newInvitationBtn')).toBeHidden();
    const address = new URL(landing.url());
    const token = new URLSearchParams(address.hash.slice(1)).get('invite');
    expect(token).toBeTruthy();
    expect(address.searchParams.get('room')).toMatch(/^[A-Z0-9]{12}$/);
    const directory = path.resolve(__dirname, '../../../.impeccable/review');
    fs.mkdirSync(directory, { recursive: true });
    await landing.screenshot({ path: path.join(directory, 'invitations-desktop.png'), fullPage: true, animations: 'disabled' });
    await landing.setViewportSize({ width: 390, height: 844 });
    await landing.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await landing.screenshot({ path: path.join(directory, 'invitations-mobile.png'), fullPage: true, animations: 'disabled' });
    expect(await landing.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await landing.locator('#copyLinkBtn').click();
    expect(await landing.evaluate(() => window.copiedLink)).toBe(landing.url());
    const deafUrl = await landing.locator('#deafLink').getAttribute('href');
    const hearingUrl = await landing.locator('#hearingLink').getAttribute('href');
    const partner = await f.context.newPage(); await partner.goto(landing.url());
    await expect(partner.locator('#copyLinkBtn')).toBeEnabled();
    expect(await partner.locator('#deafLink').getAttribute('href')).toBe(deafUrl);
    const a = await f.context.newPage(); const b = await f.context.newPage();
    a.on('request', request => urls.push(request.url())); b.on('request', request => urls.push(request.url()));
    await a.goto(deafUrl); await b.goto(hearingUrl);
    await expect(a.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await a.locator('#replyText').fill('Private invitation works'); await a.locator('#replySend').click();
    await expect(b.locator('.conversation-text')).toContainText(['Private invitation works']);
    expect(urls.every(url => !url.includes(token))).toBe(true);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('room code alone is rejected before accessing camera or microphone', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const page = await f.context.newPage();
    await page.addInitScript(() => {
      window.mediaRequests = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.mediaRequests++; throw new Error('Should never request media'); };
    });
    await page.goto(`${f.url}/hearing.html?room=GUESSABLE`);
    await expect(page.locator('#status-text')).toContainText('Invitation invalid or expired');
    expect(await page.evaluate(() => window.mediaRequests)).toBe(0);
    expect(await page.evaluate(() => Boolean(window.socket))).toBe(false);
    await expect(page.locator('#replySend')).toBeDisabled();
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('expired invitation has an explicit recovery action and never silently changes rooms', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const body = Buffer.from(JSON.stringify({ v: 1, room: 'EXPIRED', exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
    const token = `${body}.${createHmac('sha256', signingSecret).update(body).digest('base64url')}`;
    const page = await f.context.newPage();
    await page.goto(`${f.url}/?room=EXPIRED#invite=${token}`);
    await expect(page.locator('#invitationStatus')).toContainText('invalid or expired');
    await expect(page.locator('#copyLinkBtn')).toBeDisabled();
    expect(new URL(page.url()).searchParams.get('room')).toBe('EXPIRED');
    await page.locator('#newInvitationBtn').click();
    await expect(page.locator('#copyLinkBtn')).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('room')).not.toBe('EXPIRED');
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('private invitation survives application restart and reconnect preserves drafts', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const landing = await f.context.newPage(); await landing.goto(f.url);
    await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
    const a = await f.context.newPage(); const b = await f.context.newPage();
    await a.goto(await landing.locator('#deafLink').getAttribute('href'));
    await b.goto(await landing.locator('#hearingLink').getAttribute('href'));
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await b.locator('#replyText').fill('Survives restart');
    const before = await b.evaluate(() => window.socket.id);
    await f.restart();
    await expect.poll(() => b.evaluate(oldId => window.socket?.connected && window.socket.id !== oldId, before)).toBe(true);
    await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
    await expect(b.locator('#replyText')).toHaveValue('Survives restart');
    await b.locator('#replySend').click();
    await expect(a.locator('.conversation-text')).toContainText(['Survives restart']);
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

test('failed invitation creation can recover without enabling invalid role links', async ({ browser }) => {
  const f = await fixture(browser);
  try {
    const page = await f.context.newPage();
    await page.route('**/api/rooms', route => route.abort(), { times: 1 });
    await page.goto(f.url);
    await expect(page.locator('#newInvitationBtn')).toBeVisible();
    await expect(page.locator('#deafLink')).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#newInvitationBtn').click();
    await expect(page.locator('#copyLinkBtn')).toBeEnabled();
    await expect(page.locator('#deafLink')).not.toHaveAttribute('aria-disabled', 'true');
    expect(f.errors).toEqual([]);
  } finally { await f.close(); }
});

for (const width of [1440, 390]) {
  test(`expired reconnect stops retrying and retains the draft at ${width}px`, async ({ browser }, testInfo) => {
    const f = await fixture(browser);
    try {
      const landing = await f.context.newPage(); await landing.goto(f.url);
      await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
      const a = await f.context.newPage(); const b = await f.context.newPage();
      await a.goto(await landing.locator('#deafLink').getAttribute('href'));
      await b.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await b.goto(await landing.locator('#hearingLink').getAttribute('href'));
      await expect(b.locator('#replyStatus')).toHaveText('Ready to send.');
      await b.locator('#replyText').fill('Keep my reply after invitation expiry');
      const room = new URL(landing.url()).searchParams.get('room');
      const body = Buffer.from(JSON.stringify({ v: 1, room, exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
      const token = `${body}.${createHmac('sha256', signingSecret).update(body).digest('base64url')}`;
      await b.evaluate(token => { window.socket.auth.token = token; window.socket.io.engine.close(); }, token);
      await expect(b.locator('#status-text')).toHaveText('Invitation invalid or expired. Ask your partner for a new link.');
      await expect(b.locator('#replyStatus')).toHaveText('Invitation invalid or expired. Ask your partner for a new link.');
      await expect(b.locator('#replyText')).toHaveValue('Keep my reply after invitation expiry');
      await expect(b.locator('#replySend')).toBeDisabled();
      expect(await b.evaluate(() => window.socket.connected || window.socket.active)).toBe(false);
      expect(await b.locator('#remoteVideo').evaluate(video => video.srcObject)).toBeNull();
      await b.screenshot({ path: testInfo.outputPath('expired-reconnect.png'), fullPage: true });
      expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });
}
