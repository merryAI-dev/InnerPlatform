import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.harness.config.mjs';

export default defineConfig({
  ...baseConfig,
  testIgnore: [],
  testMatch: 'people-professional-profile.spec.ts',
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:4175',
  },
  webServer: {
    ...baseConfig.webServer,
    command: [
      'VITE_PLATFORM_API_ENABLED=true',
      'VITE_FIREBASE_AUTH_ENABLED=false',
      'VITE_FIRESTORE_CORE_ENABLED=false',
      'VITE_DEV_AUTH_HARNESS_ENABLED=false',
      'npm run dev -- --host localhost --port 4175',
    ].join(' '),
    url: 'http://localhost:4175/login',
    env: {
      VITE_PLATFORM_API_ENABLED: 'true',
      VITE_FIREBASE_AUTH_ENABLED: 'false',
      VITE_FIRESTORE_CORE_ENABLED: 'false',
      VITE_DEV_AUTH_HARNESS_ENABLED: 'false',
    },
  },
});
