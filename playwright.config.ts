import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR;

if (!baseURL || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(baseURL)) {
  throw new Error('PLAYWRIGHT_BASE_URL must target the isolated local Vite server.');
}
if (!outputDir) throw new Error('PLAYWRIGHT_OUTPUT_DIR must be set to the isolated runner temp directory.');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: 'line',
  outputDir,
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    actionTimeout: 15_000,
  },
});
