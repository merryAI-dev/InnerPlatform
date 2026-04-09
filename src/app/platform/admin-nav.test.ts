import { describe, expect, it } from 'vitest';
import { ADMIN_OPEN_TO_ALL_ROLES, canAccessAdminPath, canShowAdminNavItem } from './admin-nav';

describe('admin nav access control', () => {
  it('disables the admin-open bypass so route permissions control access', () => {
    expect(ADMIN_OPEN_TO_ALL_ROLES).toBe(false);
  });

  it('keeps dashboard visible but restricts cashflow to finance and admin', () => {
    expect(canShowAdminNavItem('admin', '/')).toBe(true);
    expect(canShowAdminNavItem('finance', '/')).toBe(true);
    expect(canShowAdminNavItem('pm', '/')).toBe(true);
    expect(canShowAdminNavItem('viewer', '/')).toBe(true);

    expect(canShowAdminNavItem('admin', '/cashflow')).toBe(true);
    expect(canShowAdminNavItem('finance', '/cashflow')).toBe(true);
    expect(canShowAdminNavItem('pm', '/cashflow')).toBe(false);
    expect(canShowAdminNavItem('viewer', '/cashflow')).toBe(false);
  });

  it('allows finance to access finance export surfaces but not admin settings', () => {
    expect(canAccessAdminPath('finance', '/cashflow')).toBe(true);
    expect(canAccessAdminPath('finance', '/cashflow/projects/p-1')).toBe(true);
    expect(canAccessAdminPath('finance', '/approvals')).toBe(true);
    expect(canAccessAdminPath('finance', '/settings')).toBe(false);
    expect(canAccessAdminPath('finance', '/users')).toBe(false);
  });

  it('still rejects empty or unknown roles from admin nav', () => {
    expect(canShowAdminNavItem('', '/')).toBe(false);
    expect(canShowAdminNavItem(undefined, '/')).toBe(false);
    expect(canShowAdminNavItem(null, '/')).toBe(false);
    expect(canShowAdminNavItem('unknown_role', '/')).toBe(false);
  });

  it('passes unknown paths through to the router', () => {
    expect(canAccessAdminPath('viewer', '/totally-unknown')).toBe(true);
  });
});
