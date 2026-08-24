import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.harness.config.mjs';

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: 'participation-project-breakdown.spec.ts',
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:4174',
  },
  webServer: {
    ...baseConfig.webServer,
    command: 'VITE_DEV_AUTH_HARNESS_ENABLED=true npm run dev -- --host localhost --port 4174',
    url: 'http://localhost:4174/login',
    env: {
      VITE_PLATFORM_API_ENABLED: 'true',
    },
  },
});
