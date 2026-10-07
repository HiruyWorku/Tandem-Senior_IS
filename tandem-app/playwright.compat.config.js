const { defineConfig } = require('@playwright/test');

// Run the same application journeys against additional engines, without paid providers.
module.exports = defineConfig({
  testDir: './test/browser', outputDir: './test-results-compat',
  fullyParallel: false, workers: 1, timeout: 30000,
  use: { headless: true, viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure' },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: { firefoxUserPrefs: {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
    } } } },
    { name: 'webkit', use: { browserName: 'webkit', permissions: ['camera', 'microphone'] } },
  ],
});
