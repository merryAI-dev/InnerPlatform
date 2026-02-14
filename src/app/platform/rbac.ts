import type { UserRole } from '../data/types';
import { normalizeTenantId } from './tenant';

export type PlatformRole = UserRole | 'tenant_admin' | 'support' | 'security';

export type PlatformPermission =
  | 'project:read'
  | 'project:write'
  | 'ledger:read'
  | 'ledger:write'
  | 'transaction:approve'
  | 'audit:read'
  | 'user:manage'
  | 'tenant:manage'
  | 'security:manage';

const PERMISSIONS_BY_ROLE: Record<PlatformRole, PlatformPermission[]> = {
  admin: [
    'project:read',
    'project:write',
    'ledger:read',
    'ledger:write',
    'transaction:approve',
    'audit:read',
    'user:manage',
    'tenant:manage',
    'security:manage',
  ],
  finance: ['project:read', 'project:write', 'ledger:read', 'ledger:write', 'audit:read'],
  pm: ['project:read', 'project:write', 'ledger:read', 'ledger:write'],
  viewer: ['project:read', 'ledger:read'],
  auditor: ['project:read', 'ledger:read', 'audit:read'],
  tenant_admin: ['project:read', 'project:write', 'ledger:read', 'ledger:write', 'user:manage', 'audit:read'],
  support: ['project:read', 'ledger:read', 'audit:read'],
  security: ['project:read', 'audit:read', 'security:manage'],
};

export interface FirebaseAuthClaims {
  role?: unknown;
  tenantId?: unknown;
  permissions?: unknown;
  department?: unknown;
}

export interface ResolvedAuthContext {
  role: PlatformRole;
  tenantId?: string;
  permissions: PlatformPermission[];
  department?: string;
}

function normalizeRole(role: unknown): PlatformRole {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  if (normalized in PERMISSIONS_BY_ROLE) {
    return normalized as PlatformRole;
  }
  return 'pm';
}

function normalizePermissions(value: unknown): PlatformPermission[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<PlatformPermission>([
    'project:read',
    'project:write',
    'ledger:read',
    'ledger:write',
    'transaction:approve',
    'audit:read',
    'user:manage',
    'tenant:manage',
    'security:manage',
  ]);
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is PlatformPermission => known.has(entry as PlatformPermission));
}

export function extractAuthContextFromClaims(claims?: FirebaseAuthClaims): ResolvedAuthContext {
  const role = normalizeRole(claims?.role);
  const tenantId = normalizeTenantId(claims?.tenantId);
  const permissions = normalizePermissions(claims?.permissions);
  const department = typeof claims?.department === 'string' ? claims.department.trim() : undefined;

  return {
    role,
    tenantId: tenantId || undefined,
    permissions,
    department: department || undefined,
  };
}

export function hasPermission(
  role: PlatformRole,
  permission: PlatformPermission,
  extraPermissions: PlatformPermission[] = [],
): boolean {
  const granted = new Set([...PERMISSIONS_BY_ROLE[role], ...extraPermissions]);
  return granted.has(permission);
}

export function isPrivilegedPlatformRole(role: PlatformRole): boolean {
  return role === 'admin' || role === 'finance' || role === 'auditor' || role === 'tenant_admin' || role === 'security';
}

export function canAccessTenant(options: {
  actorRole: PlatformRole;
  actorTenantId?: string;
  targetTenantId: string;
}): boolean {
  const targetTenantId = normalizeTenantId(options.targetTenantId);
  const actorTenantId = normalizeTenantId(options.actorTenantId);

  if (!targetTenantId) return false;
  if (options.actorRole === 'admin' || options.actorRole === 'support' || options.actorRole === 'security') {
    return true;
  }

  if (!actorTenantId) return false;
  return actorTenantId === targetTenantId;
}
