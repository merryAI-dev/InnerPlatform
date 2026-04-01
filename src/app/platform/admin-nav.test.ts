import { describe, expect, it } from 'vitest';
import { ADMIN_OPEN_TO_ALL_ROLES, canAccessAdminPath, canShowAdminNavItem } from './admin-nav';

const ALL_ROLES = ['admin', 'finance', 'pm', 'viewer'] as const;
const SAMPLE_ADMIN_PATHS = [
  '/',
  '/projects',
  '/projects/new',
  '/projects/migration-audit',
  '/cashflow',
  '/evidence',
  '/payroll',
  '/budget-summary',
  '/expense-management',
  '/approvals',
  '/users',
  '/audit',
  '/settings',
  '/participation',
  '/koica-personnel',
  '/personnel-changes',
  '/hr-announcements',
  '/portal',
] as const;

describe('admin nav temporary open access', () => {
  it('keeps the temporary admin-open flag enabled', () => {
    expect(ADMIN_OPEN_TO_ALL_ROLES).toBe(true);
  });

  it('shows all admin nav items to all signed-in roles', () => {
    for (const role of ALL_ROLES) {
      for (const path of SAMPLE_ADMIN_PATHS) {
        expect(canShowAdminNavItem(role, path), `${role} should see ${path}`).toBe(true);
      }
    }
  });

  it('allows all signed-in roles to access canonical admin paths', () => {
    for (const role of ALL_ROLES) {
      expect(canAccessAdminPath(role, '/projects/migration-audit')).toBe(true);
      expect(canAccessAdminPath(role, '/settings')).toBe(true);
      expect(canAccessAdminPath(role, '/users')).toBe(true);
      expect(canAccessAdminPath(role, '/projects/p-123/edit')).toBe(true);
      expect(canAccessAdminPath(role, '/cashflow/projects/p-1')).toBe(true);
    }
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
