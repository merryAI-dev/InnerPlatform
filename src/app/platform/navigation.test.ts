import { describe, expect, it } from 'vitest';
import { isAdminSpaceRole, isPortalRole, resolveHomePath } from './navigation';

describe('navigation helpers', () => {
  it('classifies portal roles', () => {
    expect(isPortalRole('pm')).toBe(true);
    expect(isPortalRole('viewer')).toBe(true);
    expect(isPortalRole('admin')).toBe(false);
  });

  it('classifies admin space roles', () => {
    expect(isAdminSpaceRole('admin')).toBe(true);
    expect(isAdminSpaceRole('security')).toBe(true);
    expect(isAdminSpaceRole('pm')).toBe(false);
  });

  it('normalizes role strings', () => {
    expect(resolveHomePath(' PM ')).toBe('/portal');
    expect(resolveHomePath('ADMIN')).toBe('/');
  });

  it('defaults unknown roles to portal space (least privilege)', () => {
    expect(resolveHomePath('unknown_role')).toBe('/portal');
    expect(resolveHomePath('')).toBe('/portal');
    expect(resolveHomePath(null)).toBe('/portal');
  });
});
