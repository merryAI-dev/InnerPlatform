import type { UserRole } from './types';

function normalizeUserRole(role: string | undefined): UserRole | undefined {
  const normalized = typeof role === 'string' ? role.trim().toLowerCase() : '';
  const effectiveRole = normalized === 'viewer' ? 'pm' : normalized;

  if (
    effectiveRole === 'admin'
    || effectiveRole === 'tenant_admin'
    || effectiveRole === 'finance'
    || effectiveRole === 'pm'
    || effectiveRole === 'auditor'
    || effectiveRole === 'support'
    || effectiveRole === 'security'
  ) {
    return effectiveRole as UserRole;
  }

  return undefined;
}

export function resolveEffectiveAuthRole(options: {
  memberRole?: string;
  claimRole?: string;
}): UserRole {
  const memberRole = normalizeUserRole(options.memberRole);
  if (memberRole) return memberRole;

  const claimRole = normalizeUserRole(options.claimRole);
  if (claimRole) return claimRole;

  return 'pm';
}
