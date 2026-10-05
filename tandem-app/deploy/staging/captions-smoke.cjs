const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

async function main() {
  const origin = new URL(process.argv[2]).origin;
  assert.equal(new URL(origin).protocol, 'https:');
  const sample = path.resolve(process.argv[3]);
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
    const speaker = await context.newPage();
    await receiver.goto(await landing.locator('#deafLink').getAttribute('href'));
    await speaker.goto(await landing.locator('#hearingLink').getAttribute('href'));
    await expect(speaker.locator('#replyStatus')).toHaveText('Ready to send.');
    for (const page of [receiver, speaker]) {
      if (await page.locator('#captionAction').textContent() === 'Start captions') await page.locator('#captionAction').click();
    }
    await expect(speaker.locator('#captionStatus')).toHaveText('Your captions on', { timeout: 30000 });
    await expect(receiver.locator('#remoteCaptions')).toContainText(/Brooklyn/i, { timeout: 30000 });
    await expect(receiver.locator('.conversation-text').filter({ hasText: /Brooklyn/i }).first()).toBeVisible({ timeout: 15000 });
    console.log('Real Google streaming transcription passed through browser AudioWorklet, Socket.IO and peer final-caption delivery.');
    await speaker.locator('#captionAction').click();
    await expect(speaker.locator('#captionStatus')).toHaveText('Your captions paused');
    await expect(receiver.locator('#peerCaptionStatus')).toHaveText('Peer captions paused');
    console.log('Caption pause acknowledged locally and by the peer.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
