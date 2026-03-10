import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173/playwright/settlement-smoke.html',
    reuseExistingServer: true,
    env: {
      VITE_FIREBASE_AUTH_ENABLED: 'false',
      VITE_FIRESTORE_CORE_ENABLED: 'false',
      VITE_QA_P0_SETTLEMENT_V1: 'true',
    },
  },
});
