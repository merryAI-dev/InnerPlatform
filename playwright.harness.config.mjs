import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'VITE_DEV_AUTH_HARNESS_ENABLED=true npm run dev -- --host localhost --port 4173',
    url: 'http://localhost:4173/login',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
