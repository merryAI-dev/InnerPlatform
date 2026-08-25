import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'admin-cashflow-export-api.spec.ts',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4175',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host localhost --port 4175',
    url: 'http://localhost:4175/login',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_DEV_AUTH_HARNESS_ENABLED: 'false',
      VITE_DEMO_LOGIN_ENABLED: 'false',
      VITE_FIREBASE_AUTH_ENABLED: 'false',
      VITE_FIRESTORE_CORE_ENABLED: 'false',
      VITE_PLATFORM_API_ENABLED: 'true',
      VITE_PLATFORM_API_BASE_URL: 'http://localhost:4175',
    },
  },
});
