import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalOnboarding.tsx'), 'utf8');

describe('PortalOnboarding entry shell', () => {
  it('uses BFF entry contracts instead of portal store bootstrap', () => {
    expect(source).toContain('data-testid="portal-onboarding-page"');
    expect(source).toContain('fetchPortalOnboardingContextViaBff');
    expect(source).toContain('upsertPortalRegistrationViaBff');
    expect(source).not.toContain('usePortalStore');
    expect(source).not.toContain('register, isRegistered, isLoading, portalUser, projects');
  });
});
