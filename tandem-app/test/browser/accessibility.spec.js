const { test, expect } = require('@playwright/test');
const { AxeBuilder } = require('@axe-core/playwright');
const { createApplication } = require('../../server');

for (const width of [1440, 390]) {
  test(`invitation and active call pages pass automated accessibility checks at ${width}px`, async ({ browser, browserName }, testInfo) => {
    const application = createApplication({ env: { ENABLE_SPEECH: 'false', ENABLE_ASL: 'false', ENABLE_AVATAR: 'false' } });
    await new Promise(resolve => application.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${application.server.address().port}`;
    let context;
    try {
      context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 },
        permissions: browserName === 'firefox' ? [] : ['camera', 'microphone'] });
      const landing = await context.newPage(); await landing.goto(origin);
      await expect(landing.locator('#copyLinkBtn')).toBeEnabled();
      const roles = await Promise.all(['#deafLink', '#hearingLink'].map(id => landing.locator(id).getAttribute('href')));
      const pages = [landing];
      for (const role of roles) {
        const page = await context.newPage(); await page.goto(new URL(role, origin).href); pages.push(page);
      }
      await expect(pages[1].locator('#replyStatus')).toHaveText('Ready to send.');
      await pages[1].locator('#replyText').fill('A readable reviewed reply.');
      await pages[1].locator('#replySend').click();
      await expect(pages[2].getByText('A readable reviewed reply.', { exact: true })).toBeVisible();
      const violations = [];
      for (const [index, page] of pages.entries()) {
        await page.evaluate(() => document.fonts.ready);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        await testInfo.attach(`accessibility-${index}.json`, { body: JSON.stringify(results), contentType: 'application/json' });
        violations.push(...results.violations.map(issue => ({ page: index, id: issue.id, impact: issue.impact,
          nodes: issue.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })));
      }
      expect(violations).toEqual([]);
    } finally {
      await context?.close(); await application.close();
    }
  });
}
