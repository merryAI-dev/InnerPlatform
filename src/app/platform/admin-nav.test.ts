import { describe, expect, it } from 'vitest';
import { canAccessAdminPath, canShowAdminNavItem } from './admin-nav';

const ALL_ROLES = ['admin', 'finance', 'pm', 'viewer'] as const;

describe('canShowAdminNavItem', () => {
  // ── admin: fullAccessRoles → everything visible ──
  it('admin sees all nav items', () => {
    const paths = [
      '/', '/projects', '/projects/new', '/board', '/cashflow', '/evidence',
      '/payroll', '/budget-summary', '/expense-management', '/approvals',
      '/users', '/audit', '/settings', '/projects/migration-audit', '/participation', '/koica-personnel',
      '/personnel-changes', '/hr-announcements', '/claude-sdk-help', '/portal',
    ];
    for (const path of paths) {
      expect(canShowAdminNavItem('admin', path), `admin should see ${path}`).toBe(true);
    }
  });

  // ── finance: explicit route list from nav-policy.json ──
  it('finance sees allowed routes', () => {
    const allowed = ['/', '/projects', '/board', '/cashflow', '/evidence', '/payroll',
      '/budget-summary', '/expense-management', '/approvals', '/audit', '/claude-sdk-help', '/portal'];
    for (const path of allowed) {
      expect(canShowAdminNavItem('finance', path), `finance should see ${path}`).toBe(true);
    }
  });

  it('finance cannot see admin-only routes', () => {
    const denied = ['/users', '/settings', '/projects/new', '/participation',
      '/koica-personnel', '/personnel-changes', '/hr-announcements', '/projects/migration-audit'];
    for (const path of denied) {
      expect(canShowAdminNavItem('finance', path), `finance should NOT see ${path}`).toBe(false);
    }
  });

  // ── pm: explicit route list from nav-policy.json ──
  it('pm sees allowed routes', () => {
    const allowed = ['/', '/projects', '/projects/new', '/board', '/cashflow',
      '/evidence', '/expense-management', '/approvals', '/claude-sdk-help', '/portal'];
    for (const path of allowed) {
      expect(canShowAdminNavItem('pm', path), `pm should see ${path}`).toBe(true);
    }
  });

  it('pm cannot see finance/admin-only routes', () => {
    const denied = ['/users', '/settings', '/payroll', '/budget-summary',
      '/audit', '/participation', '/koica-personnel', '/projects/migration-audit'];
    for (const path of denied) {
      expect(canShowAdminNavItem('pm', path), `pm should NOT see ${path}`).toBe(false);
    }
  });

  // ── viewer: minimal routes ──
  it('viewer sees minimal routes', () => {
    const allowed = ['/', '/projects', '/board', '/claude-sdk-help', '/portal'];
    for (const path of allowed) {
      expect(canShowAdminNavItem('viewer', path), `viewer should see ${path}`).toBe(true);
    }
  });

  it('viewer cannot see operational routes', () => {
    const denied = ['/cashflow', '/evidence', '/payroll', '/budget-summary',
      '/expense-management', '/approvals', '/users', '/settings', '/projects/new', '/projects/migration-audit'];
    for (const path of denied) {
      expect(canShowAdminNavItem('viewer', path), `viewer should NOT see ${path}`).toBe(false);
    }
  });

  // ── edge cases: role normalization ──
  it('normalizes role casing and whitespace', () => {
    expect(canShowAdminNavItem('ADMIN', '/users')).toBe(true);
    expect(canShowAdminNavItem(' Finance ', '/cashflow')).toBe(true);
    expect(canShowAdminNavItem('PM', '/projects')).toBe(true);
  });

  it('rejects falsy/empty/unknown roles', () => {
    expect(canShowAdminNavItem('', '/')).toBe(false);
    expect(canShowAdminNavItem(undefined, '/')).toBe(false);
    expect(canShowAdminNavItem(null, '/')).toBe(false);
    expect(canShowAdminNavItem(42, '/')).toBe(false);
    expect(canShowAdminNavItem('unknown_role', '/')).toBe(false);
  });
});

describe('canAccessAdminPath', () => {
  // ── canonical path resolution ──
  it('root path', () => {
    expect(canAccessAdminPath('admin', '/')).toBe(true);
    expect(canAccessAdminPath('viewer', '/')).toBe(true);  // viewer has '/' in nav-policy
    expect(canAccessAdminPath('', '/')).toBe(false);
  });

  it('projects list and detail (canonical → /projects)', () => {
    for (const role of ALL_ROLES) {
      expect(canAccessAdminPath(role, '/projects'), `${role} → /projects`).toBe(true);
    }
    expect(canAccessAdminPath('pm', '/projects/p-123')).toBe(true);
    expect(canAccessAdminPath('viewer', '/projects/p-abc')).toBe(true);
  });

  it('project new (canonical → /projects/new)', () => {
    expect(canAccessAdminPath('admin', '/projects/new')).toBe(true);
    expect(canAccessAdminPath('pm', '/projects/new')).toBe(true);
    expect(canAccessAdminPath('finance', '/projects/new')).toBe(false);
    expect(canAccessAdminPath('viewer', '/projects/new')).toBe(false);
  });

  it('migration audit route is admin-only', () => {
    expect(canAccessAdminPath('admin', '/projects/migration-audit')).toBe(true);
    expect(canAccessAdminPath('finance', '/projects/migration-audit')).toBe(false);
    expect(canAccessAdminPath('pm', '/projects/migration-audit')).toBe(false);
    expect(canAccessAdminPath('viewer', '/projects/migration-audit')).toBe(false);
  });

  it('project edit (canonical → /projects/new)', () => {
    expect(canAccessAdminPath('admin', '/projects/p-123/edit')).toBe(true);
    expect(canAccessAdminPath('pm', '/projects/p-123/edit')).toBe(true);
    expect(canAccessAdminPath('finance', '/projects/p-123/edit')).toBe(false);
  });

  it('cashflow routes', () => {
    expect(canAccessAdminPath('admin', '/cashflow')).toBe(true);
    expect(canAccessAdminPath('finance', '/cashflow')).toBe(true);
    expect(canAccessAdminPath('pm', '/cashflow')).toBe(true);
    expect(canAccessAdminPath('viewer', '/cashflow')).toBe(false);
    expect(canAccessAdminPath('finance', '/cashflow/projects/p-1')).toBe(true);
  });

  it('admin-only routes: users, settings', () => {
    expect(canAccessAdminPath('admin', '/users')).toBe(true);
    expect(canAccessAdminPath('admin', '/settings')).toBe(true);
    expect(canAccessAdminPath('finance', '/users')).toBe(false);
    expect(canAccessAdminPath('finance', '/settings')).toBe(false);
    expect(canAccessAdminPath('pm', '/users')).toBe(false);
    expect(canAccessAdminPath('viewer', '/settings')).toBe(false);
  });

  it('approval routes', () => {
    expect(canAccessAdminPath('admin', '/approvals')).toBe(true);
    expect(canAccessAdminPath('finance', '/approvals')).toBe(true);
    expect(canAccessAdminPath('pm', '/approvals')).toBe(true);
    expect(canAccessAdminPath('viewer', '/approvals')).toBe(false);
  });

  it('audit route', () => {
    expect(canAccessAdminPath('admin', '/audit')).toBe(true);
    expect(canAccessAdminPath('finance', '/audit')).toBe(true);
    expect(canAccessAdminPath('pm', '/audit')).toBe(false);
  });

  it('HR routes: participation, koica-personnel, personnel-changes, hr-announcements', () => {
    const hrPaths = ['/participation', '/koica-personnel', '/personnel-changes', '/hr-announcements'];
    for (const path of hrPaths) {
      expect(canAccessAdminPath('admin', path), `admin → ${path}`).toBe(true);
      expect(canAccessAdminPath('finance', path), `finance → ${path}`).toBe(false);
      expect(canAccessAdminPath('pm', path), `pm → ${path}`).toBe(false);
    }
  });

  it('prefix matching for sub-routes', () => {
    expect(canAccessAdminPath('finance', '/evidence')).toBe(true);
    expect(canAccessAdminPath('finance', '/evidence/queue')).toBe(true);
    expect(canAccessAdminPath('finance', '/payroll')).toBe(true);
    expect(canAccessAdminPath('finance', '/payroll/details')).toBe(true);
  });

  // ── unknown paths → true (NotFoundPage renders) ──
  it('unknown paths pass through (NotFoundPage handles them)', () => {
    expect(canAccessAdminPath('finance', '/totally-unknown')).toBe(true);
    expect(canAccessAdminPath('viewer', '/random-page')).toBe(true);
    expect(canAccessAdminPath('pm', '/does-not-exist')).toBe(true);
  });

  it('board route (not in prefix list → passes through)', () => {
    expect(canAccessAdminPath('admin', '/board')).toBe(true);
    expect(canAccessAdminPath('viewer', '/board')).toBe(true);
  });
});
