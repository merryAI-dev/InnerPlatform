import { describe, expect, it } from 'vitest';
import { isStateDrivenRedirectForbidden, isSystemRedirectAllowed } from './redirect-policy';

describe('redirect policy', () => {
  it('allows only auth-boundary redirects', () => {
    expect(isSystemRedirectAllowed('unauthenticated-login')).toBe(true);
    expect(isSystemRedirectAllowed('post-login-success')).toBe(true);
    expect(isSystemRedirectAllowed('preview-auth-fallback')).toBe(true);
  });

  it('forbids redirects caused by transient app state', () => {
    expect(isStateDrivenRedirectForbidden('role-missing')).toBe(true);
    expect(isStateDrivenRedirectForbidden('role-denied')).toBe(true);
    expect(isStateDrivenRedirectForbidden('workspace-missing')).toBe(true);
    expect(isStateDrivenRedirectForbidden('tenant-changed')).toBe(true);
    expect(isStateDrivenRedirectForbidden('portal-user-missing')).toBe(true);
    expect(isStateDrivenRedirectForbidden('active-project-missing')).toBe(true);
    expect(isStateDrivenRedirectForbidden('project-status-changed')).toBe(true);
  });
});
