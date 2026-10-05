const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test/browser', fullyParallel: false, workers: 1, timeout: 30000,
  use: { channel: process.env.CI || process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? undefined : 'chrome', headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure' },
});
