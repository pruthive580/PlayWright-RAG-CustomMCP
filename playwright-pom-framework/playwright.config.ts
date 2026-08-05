import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 * baseURL is selected by the TEST_ENV variable so the framework is environment-aware
 * (the MCP's run_test/diagnose_test pass `env` through as TEST_ENV). Both envs point at
 * SauceDemo here to confirm env selection without needing a second live site.
 */
const ENVS: Record<string, string> = {
  staging: 'https://www.saucedemo.com',
  prod: 'https://www.saucedemo.com',
};
const TEST_ENV = process.env.TEST_ENV || 'staging';
const baseURL = ENVS[TEST_ENV] ?? ENVS.staging;
if (process.env.TEST_ENV) console.error(`[env] TEST_ENV=${TEST_ENV} -> baseURL ${baseURL}`);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
