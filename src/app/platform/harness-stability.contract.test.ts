import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const playwrightHarnessConfigSource = readFileSync(
  resolve(import.meta.dirname, '../../../playwright.harness.config.mjs'),
  'utf8',
);

const viteConfigSource = readFileSync(
  resolve(import.meta.dirname, '../../../vite.config.ts'),
  'utf8',
);

describe('phase1 harness stability contracts', () => {
  it('runs the local harness serially to avoid dev-server churn false negatives', () => {
    expect(playwrightHarnessConfigSource).toContain('workers: 1');
    expect(playwrightHarnessConfigSource).toContain("fullyParallel: false");
    expect(playwrightHarnessConfigSource).toContain("const DEFAULT_PORTAL_HOST = 'localhost';");
    expect(playwrightHarnessConfigSource).toContain("const DEFAULT_PORTAL_PORT = '4173';");
    expect(playwrightHarnessConfigSource).toContain('const PORTAL_HOST = process.env.PORTAL_HARNESS_HOST || DEFAULT_PORTAL_HOST;');
    expect(playwrightHarnessConfigSource).toContain('const PORTAL_PORT = process.env.PORTAL_HARNESS_PORT || DEFAULT_PORTAL_PORT;');
    expect(playwrightHarnessConfigSource).toMatch(/baseURL:\s*PORTAL_ORIGIN/);
    expect(playwrightHarnessConfigSource).toMatch(
      /VITE_PLATFORM_API_BASE_URL=\$\{PORTAL_ORIGIN\}\s+npm run dev -- --host \$\{PORTAL_HOST\} --port \$\{PORTAL_PORT\}/,
    );
    expect(playwrightHarnessConfigSource).toContain('url: `${PORTAL_ORIGIN}/login`,');
  });

  it('exposes dev-harness portal entry endpoints from the vite server', () => {
    expect(viteConfigSource).toContain('devHarnessPortalApiPlugin()');
    expect(viteConfigSource).toContain("/api/v1/portal/entry-context");
    expect(viteConfigSource).toContain("/api/v1/portal/onboarding-context");
    expect(viteConfigSource).toContain("/api/v1/portal/dashboard-summary");
    expect(viteConfigSource).toContain("/api/v1/portal/payroll-summary");
    expect(viteConfigSource).toContain("/api/v1/portal/weekly-expenses-summary");
    expect(viteConfigSource).toContain("/api/v1/portal/bank-statements-summary");
    expect(viteConfigSource).toContain("/api/v1/portal/session-project");
    expect(viteConfigSource).toContain("/api/v1/portal/registration");
    expect(viteConfigSource).not.toContain('hasAuthHeader');
  });
});
