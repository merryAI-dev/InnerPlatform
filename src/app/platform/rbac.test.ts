import { describe, expect, it } from 'vitest';
import {
  canAccessTenant,
  extractAuthContextFromClaims,
  hasPermission,
  isPrivilegedPlatformRole,
} from './rbac';

describe('rbac helpers', () => {
  it('extracts auth context from firebase claims', () => {
    const context = extractAuthContextFromClaims({
      role: 'TENANT_ADMIN',
      tenantId: 'MYSC',
      permissions: ['project:read', 'invalid:perm'],
      department: 'operations',
    });

    expect(context).toEqual({
      role: 'tenant_admin',
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

  it('classifies privileged roles', () => {
    expect(isPrivilegedPlatformRole('admin')).toBe(true);
    expect(isPrivilegedPlatformRole('tenant_admin')).toBe(true);
    expect(isPrivilegedPlatformRole('pm')).toBe(false);
  });

  it('enforces tenant access for tenant-scoped roles', () => {
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't1' })).toBe(true);
    expect(canAccessTenant({ actorRole: 'pm', actorTenantId: 't1', targetTenantId: 't2' })).toBe(false);
    expect(canAccessTenant({ actorRole: 'support', actorTenantId: 't1', targetTenantId: 't2' })).toBe(true);
  });
});
