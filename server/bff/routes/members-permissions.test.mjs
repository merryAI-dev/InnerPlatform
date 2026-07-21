import { describe, expect, it } from 'vitest';
import { buildMemberPermissionOverview } from './members.mjs';

function memberEntry({ uid, role, status = 'ACTIVE', projectIds = [], disabled = false }) {
  return {
    authUid: uid,
    authDisabled: disabled,
    effectiveRole: role,
    canonicalMember: {
      uid,
      data: { uid, role, status, projectIds },
    },
    legacyMembers: [],
  };
}

const projects = [
  { id: 'p-assigned', name: '배정 사업', registeredById: 'pm-a', managerId: 'pm-a', executiveApproverId: 'head-a' },
  { id: 'p-head', name: '조직장 사업', registeredById: 'pm-b', managerId: 'pm-b', executiveApproverId: 'head-a' },
];

describe('member permission overview', () => {
  it('shows project-access close requests and designated organization-head approvals separately', () => {
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'head-a', role: 'viewer' }),
      projects,
    )).toEqual({
      isActive: true,
      accessibleProjects: [
        { id: 'p-assigned', name: '배정 사업' },
        { id: 'p-head', name: '조직장 사업' },
      ],
      organizationHeadProjects: [
        { id: 'p-assigned', name: '배정 사업' },
        { id: 'p-head', name: '조직장 사업' },
      ],
      canRequestCashflowClose: true,
      canApproveProjectRegistration: true,
      canDecideCashflowReopen: false,
    });
  });

  it('grants reopen decisions only to active Finance/Admin users', () => {
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'finance-a', role: 'finance' }),
      projects,
    )).toMatchObject({
      isActive: true,
      canRequestCashflowClose: true,
      canApproveProjectRegistration: false,
      canDecideCashflowReopen: true,
    });
    expect(buildMemberPermissionOverview(
      memberEntry({ uid: 'finance-a', role: 'finance', status: 'INACTIVE' }),
      projects,
    )).toMatchObject({
      isActive: false,
      canRequestCashflowClose: false,
      canDecideCashflowReopen: false,
    });
  });
});
