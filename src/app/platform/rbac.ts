import type { UserRole } from '../data/types';
import { normalizeTenantId } from './tenant';
import rbacPolicyJson from '../../../policies/rbac-policy.json';

// PlatformRole historically extended UserRole, but UserRole now contains all platform roles.
// Keep the alias to avoid large ripples while keeping a single source of truth for role names.
export type PlatformRole = UserRole;

export type PlatformPermission =
  | 'project:read'
  | 'project:write'
  | 'ledger:read'
  | 'ledger:write'
  | 'transaction:submit'
  | 'transaction:approve'
  | 'transaction:reject'
  | 'comment:read'
  | 'comment:write'
  | 'evidence:read'
  | 'evidence:write'
  | 'audit:read'
  | 'user:manage'
  | 'tenant:manage'
  | 'security:manage';

type RbacPolicy = {
  defaultRole?: unknown;
  rolePermissions?: unknown;
};

const PLATFORM_ROLES: PlatformRole[] = ['admin', 'finance', 'pm', 'viewer', 'auditor', 'tenant_admin', 'support', 'security'];

const KNOWN_PERMISSIONS = new Set<PlatformPermission>([
  'project:read',
  'project:write',
  'ledger:read',
  'ledger:write',
  'transaction:submit',
  'transaction:approve',
  'transaction:reject',
  'comment:read',
  'comment:write',
  'evidence:read',
  'evidence:write',
  'audit:read',
  'user:manage',
  'tenant:manage',
  'security:manage',
]);

function normalizePlatformRole(value: unknown): PlatformRole | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) return null;
  return PLATFORM_ROLES.includes(normalized as PlatformRole) ? (normalized as PlatformRole) : null;
}

function normalizePolicyPermissions(value: unknown): PlatformPermission[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is PlatformPermission => KNOWN_PERMISSIONS.has(entry as PlatformPermission));
}

const RBAC_POLICY = rbacPolicyJson as unknown as RbacPolicy;
const DEFAULT_ROLE: PlatformRole = normalizePlatformRole(RBAC_POLICY.defaultRole) ?? 'viewer';

const PERMISSIONS_BY_ROLE: Record<PlatformRole, PlatformPermission[]> = (() => {
  const mapping: Record<PlatformRole, PlatformPermission[]> = {
    admin: [],
    finance: [],
    pm: [],
    viewer: [],
    auditor: [],
    tenant_admin: [],
    support: [],
    security: [],
  };

  const raw = RBAC_POLICY.rolePermissions && typeof RBAC_POLICY.rolePermissions === 'object'
    ? (RBAC_POLICY.rolePermissions as Record<string, unknown>)
    : {};

  for (const role of PLATFORM_ROLES) {
    mapping[role] = normalizePolicyPermissions(raw[role]);
  }
  return mapping;
})();

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
  return normalizePlatformRole(role) ?? DEFAULT_ROLE;
}

function normalizePermissions(value: unknown): PlatformPermission[] {
  return normalizePolicyPermissions(value);
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
