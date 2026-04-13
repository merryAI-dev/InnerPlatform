import type { UserRole } from '../../data/types';
import type { AuthGovernanceSummary, AuthGovernanceUserRow } from '../../lib/platform-bff-client';

export interface AuthGovernanceFilters {
  searchText: string;
  role: 'ALL' | UserRole;
  drift: 'ALL' | 'DRIFT_ONLY' | 'CLEAN_ONLY';
  source: 'ALL' | 'AUTH_MISSING' | 'MEMBER_MISSING' | 'BOOTSTRAP';
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function getRecommendedGovernanceRole(row: AuthGovernanceUserRow): UserRole {
  const effective = (row.effectiveRole || '').trim().toLowerCase();
  if (row.bootstrapAdmin) return 'admin';
  if (effective === 'admin' || effective === 'finance' || effective === 'pm') {
    return effective as UserRole;
  }
  return 'pm';
}

export function filterGovernanceRows(
  rows: AuthGovernanceUserRow[],
  filters: AuthGovernanceFilters,
): AuthGovernanceUserRow[] {
  const q = normalizeText(filters.searchText);
  return rows.filter((row) => {
    if (filters.role !== 'ALL' && getRecommendedGovernanceRole(row) !== filters.role) return false;
    if (filters.drift === 'DRIFT_ONLY' && !row.needsDeepSync) return false;
    if (filters.drift === 'CLEAN_ONLY' && row.needsDeepSync) return false;
    if (filters.source === 'AUTH_MISSING' && !row.driftFlags.includes('missing_auth')) return false;
    if (filters.source === 'MEMBER_MISSING' && !row.driftFlags.includes('missing_canonical_member')) return false;
    if (filters.source === 'BOOTSTRAP' && !row.bootstrapAdmin) return false;
    if (!q) return true;

    const haystack = [
      row.email,
      row.displayName,
      row.authUid || '',
      row.canonicalMember?.docId || '',
      row.canonicalMember?.name || '',
      row.legacyMembers.map((item) => item.docId).join(' '),
      row.driftFlags.join(' '),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

export function emptyGovernanceSummary(): AuthGovernanceSummary {
  return {
    total: 0,
    needsDeepSync: 0,
    missingAuth: 0,
    missingCanonicalMember: 0,
    duplicateMemberDocs: 0,
    bootstrapCandidates: 0,
  };
}
