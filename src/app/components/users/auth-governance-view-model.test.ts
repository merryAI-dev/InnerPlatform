import { describe, expect, it } from 'vitest';
import { emptyGovernanceSummary, filterGovernanceRows, getRecommendedGovernanceRole } from './auth-governance-view-model';
import type { AuthGovernanceUserRow } from '../../lib/platform-bff-client';

const baseRow: AuthGovernanceUserRow = {
  identityKey: 'jslee@mysc.co.kr',
  email: 'jslee@mysc.co.kr',
  authUid: 'uid-jslee',
  displayName: 'JS Lee',
  authDisabled: false,
  bootstrapAdmin: true,
  claimRole: 'pm',
  claimTenantId: 'mysc',
  canonicalMember: {
    docId: 'uid-jslee',
    uid: 'uid-jslee',
    email: 'jslee@mysc.co.kr',
    role: 'pm',
    status: 'ACTIVE',
    name: '이재성',
  },
  legacyMembers: [],
  effectiveRole: 'pm',
  driftFlags: ['bootstrap_admin_not_adopted'],
  needsDeepSync: true,
};

describe('auth governance view model helpers', () => {
  it('recommends admin for bootstrap admin candidates', () => {
    expect(getRecommendedGovernanceRole(baseRow)).toBe('admin');
  });

  it('filters drift-only and text matches', () => {
    const rows = [
      baseRow,
      {
        ...baseRow,
        identityKey: 'pm@mysc.co.kr',
        email: 'pm@mysc.co.kr',
        bootstrapAdmin: false,
        effectiveRole: 'pm',
        driftFlags: [],
        needsDeepSync: false,
      },
    ];

    const filtered = filterGovernanceRows(rows, {
      searchText: 'jslee',
      role: 'ALL',
      drift: 'DRIFT_ONLY',
      source: 'ALL',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].email).toBe('jslee@mysc.co.kr');
  });

  it('returns an empty summary shape', () => {
    expect(emptyGovernanceSummary()).toEqual({
      total: 0,
      needsDeepSync: 0,
      missingAuth: 0,
      missingCanonicalMember: 0,
      duplicateMemberDocs: 0,
      bootstrapCandidates: 0,
    });
  });
});
