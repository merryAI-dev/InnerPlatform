import { describe, expect, it } from 'vitest';
import { canAccessAdminPath, canShowAdminNavItem } from './admin-nav';

describe('admin nav policy', () => {
  it('allows full access for admin roles', () => {
    expect(canShowAdminNavItem('admin', '/projects/new')).toBe(true);
    expect(canShowAdminNavItem('tenant_admin', '/users')).toBe(true);
  });

  it('filters finance to core + finance + approvals + audit', () => {
    expect(canShowAdminNavItem('finance', '/cashflow')).toBe(true);
    expect(canShowAdminNavItem('finance', '/payroll')).toBe(true);
    expect(canShowAdminNavItem('finance', '/approvals')).toBe(true);
    expect(canShowAdminNavItem('finance', '/board')).toBe(true);
    expect(canShowAdminNavItem('finance', '/users')).toBe(false);
    expect(canShowAdminNavItem('finance', '/projects/new')).toBe(false);
    expect(canShowAdminNavItem('finance', '/koica-personnel')).toBe(false);
  });

  it('filters auditor to read-only surfaces (no approvals/settings/users)', () => {
    expect(canShowAdminNavItem('auditor', '/audit')).toBe(true);
    expect(canShowAdminNavItem('auditor', '/board')).toBe(true);
    expect(canShowAdminNavItem('auditor', '/payroll')).toBe(true);
    expect(canShowAdminNavItem('auditor', '/approvals')).toBe(false);
    expect(canShowAdminNavItem('auditor', '/settings')).toBe(false);
    expect(canShowAdminNavItem('auditor', '/users')).toBe(false);
    expect(canShowAdminNavItem('auditor', '/projects/new')).toBe(false);
  });

  it('denies unknown roles by default', () => {
    expect(canShowAdminNavItem('unknown_role', '/')).toBe(false);
    expect(canShowAdminNavItem(undefined, '/')).toBe(false);
  });

  it('guards direct URL access for dynamic admin routes', () => {
    expect(canAccessAdminPath('finance', '/projects/p-123')).toBe(true);
    expect(canAccessAdminPath('finance', '/projects/p-123/edit')).toBe(false);
    expect(canAccessAdminPath('finance', '/users')).toBe(false);
    expect(canAccessAdminPath('finance', '/settings')).toBe(false);
    expect(canAccessAdminPath('admin', '/users')).toBe(true);
  });

  it('does not block unknown paths (lets NotFoundPage render)', () => {
    expect(canAccessAdminPath('finance', '/totally-unknown')).toBe(true);
  });
});
