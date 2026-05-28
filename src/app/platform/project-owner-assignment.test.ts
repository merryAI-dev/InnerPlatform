import { describe, expect, it } from 'vitest';
import { buildProjectOwnerAssignmentPatches } from './project-owner-assignment';

describe('project owner assignment patches', () => {
  it('adds project to next registered owner and removes from previous owner', () => {
    const patches = buildProjectOwnerAssignmentPatches({
      projectId: 'p1',
      projectName: '테스트 사업',
      previousOwnerId: 'old',
      nextOwner: { uid: 'new', name: '새 담당자', email: 'new@mysc.co.kr' },
      previousMember: { projectIds: ['p1', 'p2'], projectNames: { p1: '테스트 사업' } },
      nextMember: { projectIds: ['p3'], projectNames: {} },
    });

    expect(patches.project).toMatchObject({
      registeredById: 'new',
      registeredByName: '새 담당자',
      registeredByEmail: 'new@mysc.co.kr',
      managerId: 'new',
      managerName: '새 담당자',
    });
    expect(patches.requestPayload).toMatchObject({
      registeredById: 'new',
      registeredByName: '새 담당자',
      registeredByEmail: 'new@mysc.co.kr',
      managerId: 'new',
      managerName: '새 담당자',
    });
    expect(patches.previous?.projectIds).toEqual(['p2']);
    expect(patches.next?.projectIds).toEqual(['p3', 'p1']);
    expect(patches.next?.projectNames?.p1).toBe('테스트 사업');
  });

  it('does not remove ownership when the selected owner is unchanged', () => {
    const patches = buildProjectOwnerAssignmentPatches({
      projectId: 'p1',
      projectName: '테스트 사업',
      previousOwnerId: 'same',
      nextOwner: { uid: 'same', name: '같은 담당자' },
      previousMember: { projectIds: ['p1'], projectNames: { p1: '테스트 사업' } },
      nextMember: { projectIds: ['p1'], projectNames: { p1: '테스트 사업' } },
    });

    expect(patches.previous).toBeNull();
    expect(patches.next?.projectIds).toEqual(['p1']);
  });
});
