const { test, expect } = require('@playwright/test');
const { createApplication } = require('../../server');

for (const unavailable of [false, true]) {
  test(`call pages ${unavailable ? 'remain usable without font files' : 'load their fonts without external requests'}`, async ({ browser }) => {
    const application = createApplication({ env: { ENABLE_SPEECH: 'false', ENABLE_ASL: 'false', ENABLE_AVATAR: 'false' } });
    await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${application.server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const external = [], fontResponses = [];
    context.on('request', request => {
      if (new URL(request.url()).origin !== origin) external.push(new URL(request.url()).hostname);
    });
    context.on('response', response => {
      if (response.url().endsWith('.woff2')) fontResponses.push(response.status());
    });
    if (unavailable) await context.route('**/*.woff2', route => route.abort());
    try {
      const landing = await context.newPage();
      await landing.goto(origin);
      await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
      const roles = await Promise.all(['#deafLink', '#hearingLink'].map(id => landing.locator(id).getAttribute('href')));
      const pages = [landing];
      for (const role of roles) {
        const page = await context.newPage();
        await page.goto(new URL(role, origin).href);
        pages.push(page);
      }
      for (const page of pages) {
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
        if (!unavailable) {
          const loaded = await page.evaluate(() => [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family));
          expect(loaded).toEqual(expect.arrayContaining(['DM Sans', 'Fraunces']));
        }
      }
      // Sharing and conversation remain operable when every font request fails.
      await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
      await expect(pages[1].locator('#replyStatus')).toHaveText('Ready to send.');
      await pages[1].locator('#replyText').fill('Readable reply with local font policy');
      await pages[1].locator('#replySend').click();
      await expect(pages[2].getByText('Readable reply with local font policy', { exact: true })).toBeVisible();
      expect(external).toEqual([]);
      if (!unavailable) {
        expect(fontResponses.length).toBeGreaterThan(0);
        expect(fontResponses.every(status => status === 200)).toBe(true);
      }
    } finally {
      await context.close();
      await application.close();
    }
  });
}
