import path from 'node:path';
import { defineConfig } from '@playwright/test';

process.env.PORTAL_NETWORK_ARTIFACT_DIR ||= path.resolve('test-results/portal-network-artifacts');

const PORTAL_ORIGIN = 'http://localhost:4173';
const PORTAL_HOST = 'localhost';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    // Keep the localhost origin stable for auth/session storage semantics.
    baseURL: PORTAL_ORIGIN,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `VITE_DEV_AUTH_HARNESS_ENABLED=true VITE_PLATFORM_API_BASE_URL=${PORTAL_ORIGIN} npm run dev -- --host ${PORTAL_HOST} --port 4173`,
    url: `${PORTAL_ORIGIN}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
