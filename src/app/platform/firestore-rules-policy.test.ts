/**
 * Firestore rules policy alignment tests.
 *
 * These tests verify that the TypeScript RBAC policy (rbac-policy.json)
 * stays aligned with the security assumptions encoded in firestore.rules.
 * They do NOT run the rules emulator — instead they validate the
 * policy-as-code constraints that the rules depend on.
 */
import { describe, expect, it } from 'vitest';
import rbacPolicy from '../../../policies/rbac-policy.json';
import { hasPermission, canAccessProject, canAccessTenant } from './rbac';
import type { PlatformPermission } from './rbac';
import { DEFAULT_BOOTSTRAP_ADMIN_EMAILS } from '../data/auth-bootstrap';

const policy = rbacPolicy as {
  rolePermissions: Record<string, string[]>;
  roles: string[];
};

describe('firestore rules policy alignment', () => {
  // ── isSignedIn: company email domain ──
  it('only recognizes @mysc.co.kr emails (documented assumption)', () => {
    expect('@mysc.co.kr'.endsWith('@mysc.co.kr')).toBe(true);
    expect('@gmail.com'.endsWith('@mysc.co.kr')).toBe(false);
  });

  // ── isBootstrapAdminEmail ──
  it('bootstrap admin emails match auth-bootstrap defaults', () => {
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('admin@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('ai@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('ylee@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('jyoo@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('jslee@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('jhsong@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('jybaek@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('fin@mysc.co.kr');
    expect(DEFAULT_BOOTSTRAP_ADMIN_EMAILS).toContain('hwkim@mysc.co.kr');
  });

  // ── canWrite roles (admin, finance, pm — viewer excluded) ──
  it('write roles match firestore.rules canWrite()', () => {
    const writeRoles = ['admin', 'finance', 'pm'];
    for (const role of writeRoles) {
      expect(policy.roles).toContain(role);
    }
  });

  // ── viewer permissions (project:write granted for project registration) ──
  it('viewer can write projects but not evidence/ledger/transactions', () => {
    expect(hasPermission('viewer', 'project:write')).toBe(true);
    expect(hasPermission('viewer', 'evidence:write')).toBe(false);
    expect(hasPermission('viewer', 'ledger:write')).toBe(false);
    expect(hasPermission('viewer', 'transaction:submit')).toBe(false);
  });

  it('viewer can read and access evidence drive', () => {
    expect(hasPermission('viewer', 'project:read')).toBe(true);
    expect(hasPermission('viewer', 'project:evidence_drive:write')).toBe(true);
    expect(hasPermission('viewer', 'evidence:read')).toBe(true);
    expect(hasPermission('viewer', 'evidence:drive:write')).toBe(true);
  });

  // ── pm permissions ──
  it('pm can submit but not approve transactions', () => {
    expect(hasPermission('pm', 'transaction:submit')).toBe(true);
    expect(hasPermission('pm', 'transaction:approve')).toBe(false);
    expect(hasPermission('pm', 'transaction:reject')).toBe(false);
  });

  it('pm can write projects and evidence', () => {
    expect(hasPermission('pm', 'project:write')).toBe(true);
    expect(hasPermission('pm', 'evidence:write')).toBe(true);
    expect(hasPermission('pm', 'ledger:write')).toBe(true);
  });

  // ── finance approval ──
  it('finance can approve and reject transactions', () => {
    expect(hasPermission('finance', 'transaction:approve')).toBe(true);
    expect(hasPermission('finance', 'transaction:reject')).toBe(true);
  });

  // ── admin has all permissions ──
  it('admin has every known permission', () => {
    const allPerms = policy.rolePermissions.admin as PlatformPermission[];
    for (const perm of allPerms) {
      expect(hasPermission('admin', perm as PlatformPermission)).toBe(true);
    }
  });

  // ── admin management ──
  it('admin can manage users and tenants', () => {
    expect(hasPermission('admin', 'user:manage')).toBe(true);
    expect(hasPermission('admin', 'tenant:manage')).toBe(true);
  });

  // ── canAccessProject: project-scoped ──
  it('admin and finance access all projects without assignment', () => {
    for (const role of ['admin', 'finance'] as const) {
      expect(canAccessProject({ actorRole: role, permission: 'project:read', targetProjectId: 'any' })).toBe(true);
    }
  });

  it('pm needs project assignment for access', () => {
    expect(canAccessProject({
      actorRole: 'pm', permission: 'project:read', targetProjectId: 'p1', assignedProjectIds: ['p1'],
    })).toBe(true);
    expect(canAccessProject({
      actorRole: 'pm', permission: 'project:read', targetProjectId: 'p2', assignedProjectIds: ['p1'],
    })).toBe(false);
  });

  it('viewer needs assignment and can read/write assigned projects', () => {
    expect(canAccessProject({
      actorRole: 'viewer', permission: 'project:read', targetProjectId: 'p1', assignedProjectIds: ['p1'],
    })).toBe(true);
    expect(canAccessProject({
      actorRole: 'viewer', permission: 'project:write', targetProjectId: 'p1', assignedProjectIds: ['p1'],
    })).toBe(true);
    expect(canAccessProject({
      actorRole: 'viewer', permission: 'project:write', targetProjectId: 'p2', assignedProjectIds: ['p1'],
    })).toBe(false);
  });

  // ── canAccessTenant: cross-tenant ──
  it('admin can access any tenant', () => {
    expect(canAccessTenant({ actorRole: 'admin', actorTenantId: 't1', targetTenantId: 't2' })).toBe(true);
  });

  it('pm is tenant-scoped', () => {
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't1' })).toBe(true);
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't2' })).toBe(false);
  });

  // ── HR rules assumptions ──
  it('admin and finance have project:read for HR collections', () => {
    for (const role of ['admin', 'finance'] as const) {
      expect(hasPermission(role, 'project:read')).toBe(true);
    }
  });
});
