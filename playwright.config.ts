import { defineConfig, devices } from '@playwright/test';

/**
 * Runs against the production build (vite preview), so the service worker, precache and CSP
 * are the real ones.
 *
 * - webkit-iphone: the brief's target. Needs Playwright's WebKit (`npx playwright install webkit`).
 * - chromium-iphone: same viewport and touch, for machines without WebKit.
 *
 * Neither is real iOS Safari: glass rendering, the share sheet, haptics and canvas memory limits
 * still need the device checklist in docs/DEVICE-CHECK.md.
 */
const iphone = {
  ...devices['iPhone 14 Pro'],
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'webkit-iphone', use: { ...iphone, browserName: 'webkit' } },
    {
      name: 'chromium-iphone',
      use: {
        ...iphone,
        browserName: 'chromium',
        defaultBrowserType: 'chromium',
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
});
