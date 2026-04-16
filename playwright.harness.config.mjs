import path from 'node:path';
import { defineConfig } from '@playwright/test';

process.env.PORTAL_NETWORK_ARTIFACT_DIR ||= path.resolve('test-results/portal-network-artifacts');

const DEFAULT_PORTAL_HOST = 'localhost';
const DEFAULT_PORTAL_PORT = '4173';
const DEFAULT_PORTAL_ORIGIN = `http://${DEFAULT_PORTAL_HOST}:${DEFAULT_PORTAL_PORT}`;
const PORTAL_HOST = process.env.PORTAL_HARNESS_HOST || DEFAULT_PORTAL_HOST;
const PORTAL_PORT = process.env.PORTAL_HARNESS_PORT || DEFAULT_PORTAL_PORT;
const PORTAL_ORIGIN = process.env.PORTAL_HARNESS_ORIGIN || `http://${PORTAL_HOST}:${PORTAL_PORT}`;

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
    command: `VITE_DEV_AUTH_HARNESS_ENABLED=true VITE_PLATFORM_API_BASE_URL=${PORTAL_ORIGIN} npm run dev -- --host ${PORTAL_HOST} --port ${PORTAL_PORT}`,
    url: `${PORTAL_ORIGIN}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
