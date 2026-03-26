import { describe, expect, it } from 'vitest';
import {
  canAccessProject,
  canAccessTenant,
  extractAuthContextFromClaims,
  hasPermission,
} from './rbac';

describe('rbac helpers', () => {
  it('extracts auth context from firebase claims', () => {
    const context = extractAuthContextFromClaims({
      role: 'FINANCE',
      tenantId: 'MYSC',
      permissions: ['project:read', 'invalid:perm'],
      department: 'operations',
    });

    expect(context).toEqual({
      role: 'finance',
      tenantId: 'mysc',
      permissions: ['project:read'],
      department: 'operations',
    });
  });

  it('checks permissions from role and extras', () => {
    expect(hasPermission('pm', 'project:write')).toBe(true);
    expect(hasPermission('pm', 'audit:read')).toBe(false);
    expect(hasPermission('pm', 'audit:read', ['audit:read'])).toBe(true);
  });

  it('defaults unknown roles to viewer (least privilege)', () => {
    const context = extractAuthContextFromClaims({
      role: 'UNKNOWN_ROLE',
      permissions: ['project:write'],
    });

    expect(context.role).toBe('viewer');
    // Extra permissions still get normalized, but the default role stays least-privileged.
    expect(context.permissions).toEqual(['project:write']);
  });

  it('grants finance approvals and admin tenant management based on policy', () => {
    expect(hasPermission('finance', 'transaction:approve')).toBe(true);
    expect(hasPermission('admin', 'tenant:manage')).toBe(true);
  });

  it('keeps viewer least-privileged but allows evidence drive workflows', () => {
    expect(hasPermission('viewer', 'project:write')).toBe(false);
    expect(hasPermission('viewer', 'project:evidence_drive:write')).toBe(true);
    expect(hasPermission('viewer', 'evidence:write')).toBe(false);
    expect(hasPermission('viewer', 'evidence:drive:write')).toBe(true);
  });

  it('enforces tenant access for tenant-scoped roles', () => {
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't1' })).toBe(true);
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't2' })).toBe(false);
    expect(canAccessTenant({ actorRole: 'admin', actorTenantId: 't1', targetTenantId: 't2' })).toBe(true);
  });

  it('checks project-scoped access based on role and assignment', () => {
    // Admin can access any project without assignment
    expect(canAccessProject({ actorRole: 'admin', permission: 'project:read', targetProjectId: 'p1' })).toBe(true);
    expect(canAccessProject({ actorRole: 'finance', permission: 'project:write', targetProjectId: 'p1' })).toBe(true);

    // PM needs assignment
    expect(canAccessProject({ actorRole: 'pm', permission: 'project:write', targetProjectId: 'p1', assignedProjectIds: ['p1', 'p2'] })).toBe(true);
    expect(canAccessProject({ actorRole: 'pm', permission: 'project:write', targetProjectId: 'p3', assignedProjectIds: ['p1', 'p2'] })).toBe(false);

    // Viewer cannot write even with assignment
    expect(canAccessProject({ actorRole: 'viewer', permission: 'project:write', targetProjectId: 'p1', assignedProjectIds: ['p1'] })).toBe(false);

    // Viewer can read with assignment
    expect(canAccessProject({ actorRole: 'viewer', permission: 'project:read', targetProjectId: 'p1', assignedProjectIds: ['p1'] })).toBe(true);
    expect(canAccessProject({ actorRole: 'viewer', permission: 'project:read', targetProjectId: 'p2', assignedProjectIds: ['p1'] })).toBe(false);
  });
});
