import { describe, expect, it } from 'vitest';
import {
  TENANT_WIDE_PROJECT_ROLES,
  hasProjectAccess,
  isActiveActorMember,
  isProjectInActorScope,
  memberProjectIds,
} from './cashflow-project-scope.mjs';

// JVM 과 판정이 갈리면 한쪽 경로만 뚫린다. 아래 표는
// WeeklyExpenseAuthorizationService.requireProjectAllowed 와
// FirestoreWeeklyProjectAccessRepository 의 규칙을 그대로 옮긴 것이며,
// Java 쪽을 고칠 때 이 표도 함께 고쳐야 한다.
const member = (patch = {}) => ({
  uid: 'pm-1', email: 'pm@example.com', status: 'ACTIVE', role: 'pm', ...patch,
});

describe('member project ids', () => {
  it('reads the same four fields the JVM repository reads', () => {
    const ids = memberProjectIds({
      projectId: 'p-root',
      projectIds: ['p-list-1', 'p-list-2'],
      portalProfile: { projectId: 'p-profile', projectIds: ['p-profile-list'] },
    });
    expect([...ids]).toEqual(['p-root', 'p-list-1', 'p-list-2', 'p-profile', 'p-profile-list']);
  });

  it.each([
    ['빈 문자열', { projectId: '' }],
    ['공백', { projectId: '   ' }],
    ['배열 아님', { projectIds: 'p-a' }],
    ['portalProfile 이 객체 아님', { portalProfile: 'p-a' }],
  ])('ignores %s', (_label, patch) => {
    expect(memberProjectIds(patch).size).toBe(0);
  });
});

describe('active actor member', () => {
  it('requires ACTIVE status', () => {
    expect(isActiveActorMember(member(), 'pm-1')).toBe(true);
    expect(isActiveActorMember(member({ status: 'DISABLED' }), 'pm-1')).toBe(false);
    expect(isActiveActorMember(member({ status: '' }), 'pm-1')).toBe(false);
  });

  it('accepts a blank uid but rejects another actor uid', () => {
    expect(isActiveActorMember(member({ uid: '' }), 'pm-1')).toBe(true);
    expect(isActiveActorMember(member({ uid: 'someone-else' }), 'pm-1')).toBe(false);
  });

  it('treats a missing member as inactive', () => {
    expect(isActiveActorMember(null, 'pm-1')).toBe(false);
  });
});

describe('project access', () => {
  it('grants only when an active member document lists the project', () => {
    const members = [member({ projectIds: ['project-a'] })];
    expect(hasProjectAccess({ members, actorId: 'pm-1', projectId: 'project-a' })).toBe(true);
    expect(hasProjectAccess({ members, actorId: 'pm-1', projectId: 'project-b' })).toBe(false);
  });

  it('ignores assignments carried by an inactive or foreign document', () => {
    expect(hasProjectAccess({
      members: [member({ status: 'DISABLED', projectIds: ['project-a'] })],
      actorId: 'pm-1',
      projectId: 'project-a',
    })).toBe(false);
    expect(hasProjectAccess({
      members: [member({ uid: 'other-1', projectIds: ['project-a'] })],
      actorId: 'pm-1',
      projectId: 'project-a',
    })).toBe(false);
  });

  it('rejects a blank project id and an empty member list', () => {
    expect(hasProjectAccess({ members: [member({ projectIds: ['project-a'] })], actorId: 'pm-1', projectId: '' })).toBe(false);
    expect(hasProjectAccess({ members: [], actorId: 'pm-1', projectId: 'project-a' })).toBe(false);
  });
});

describe('scope decision — JVM requireProjectAllowed parity', () => {
  it.each(TENANT_WIDE_PROJECT_ROLES)('lets tenant-wide role %s through without any assignment', (role) => {
    expect(isProjectInActorScope({ role, members: [], actorId: 'x', projectId: 'project-a' })).toBe(true);
  });

  it.each(['pm', 'workspace_user', 'viewer', ''])('makes scoped role %j depend on the assignment', (role) => {
    expect(isProjectInActorScope({ role, members: [], actorId: 'pm-1', projectId: 'project-a' })).toBe(false);
    expect(isProjectInActorScope({
      role,
      members: [member({ role, projectIds: ['project-a'] })],
      actorId: 'pm-1',
      projectId: 'project-a',
    })).toBe(true);
  });

  it('lets a workspace-mode workspace user through, matching the JVM WORKSPACE_COMMANDS branch', () => {
    expect(isProjectInActorScope({
      role: 'workspace_user', members: [], actorId: 'pm-1', projectId: 'project-a', workspaceUser: true,
    })).toBe(true);
  });

  it('matches roles case-insensitively like the JVM lowercase normalization', () => {
    expect(isProjectInActorScope({ role: 'Admin', members: [], actorId: 'x', projectId: 'project-a' })).toBe(true);
    expect(isProjectInActorScope({ role: ' FINANCE ', members: [], actorId: 'x', projectId: 'project-a' })).toBe(true);
  });
});
