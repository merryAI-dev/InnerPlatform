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
    expect(hasPermission('finance', 'cashflow:export')).toBe(true);
    expect(hasPermission('admin', 'tenant:manage')).toBe(true);
    expect(hasPermission('pm', 'cashflow:export')).toBe(false);
    expect(hasPermission('viewer', 'cashflow:export')).toBe(false);
  });

  it('limits professional-profile access to admin and finance', () => {
    expect(hasPermission('admin', 'person:professional_profile:read')).toBe(true);
    expect(hasPermission('admin', 'person:professional_profile:write')).toBe(true);
    expect(hasPermission('finance', 'person:professional_profile:read')).toBe(true);
    expect(hasPermission('finance', 'person:professional_profile:write')).toBe(true);
    expect(hasPermission('pm', 'person:professional_profile:read')).toBe(false);
    expect(hasPermission('pm', 'person:professional_profile:write')).toBe(false);
    expect(hasPermission('viewer', 'person:professional_profile:read')).toBe(false);
    expect(hasPermission('viewer', 'person:professional_profile:write')).toBe(false);
  });

  it('keeps viewer least-privileged but allows evidence drive workflows', () => {
    expect(hasPermission('viewer', 'project:write')).toBe(true);
    expect(hasPermission('viewer', 'project:evidence_drive:write')).toBe(true);
    expect(hasPermission('viewer', 'evidence:write')).toBe(false);
    expect(hasPermission('viewer', 'evidence:drive:write')).toBe(true);
  });

  it('enforces tenant access for tenant-scoped roles', () => {
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't1' })).toBe(true);
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't2' })).toBe(false);
    expect(canAccessTenant({ actorRole: 'admin', actorTenantId: 't1', targetTenantId: 't2' })).toBe(true);
  });

  it('gives every role access to every project, assigned or not', () => {
    // The organisation works across all projects, so assignment no longer gates access.
    for (const actorRole of ['admin', 'finance', 'pm', 'viewer'] as const) {
      expect(canAccessProject({ actorRole, permission: 'project:read', targetProjectId: 'p1' })).toBe(true);
      expect(canAccessProject({ actorRole, permission: 'project:write', targetProjectId: 'p1' })).toBe(true);
      expect(canAccessProject({
        actorRole, permission: 'project:write', targetProjectId: 'p3', assignedProjectIds: ['p1', 'p2'],
      })).toBe(true);
    }
  });

});
