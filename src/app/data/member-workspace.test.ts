import { describe, expect, it } from 'vitest';
import { readMemberWorkspace, resolveMemberProjectAccessState } from './member-workspace';

describe('member workspace project access', () => {
  it('preserves portal profile assignments when root project fields are stale', () => {
    const candidate = {
      projectId: 'legacy-project',
      projectIds: [],
      portalProfile: {
        projectId: 'p1772624885396',
        projectIds: ['p1772624885396', 'p-other'],
        projectNames: {
          p1772624885396: '사업 A',
        },
      },
    };

    const access = resolveMemberProjectAccessState(candidate);

    expect(access.normalizedProjectId).toBe('p1772624885396');
    expect(access.normalizedProjectIds).toEqual(['legacy-project', 'p1772624885396', 'p-other']);
    expect(access.needsRootSync).toBe(true);
  });

  it('flags object-shaped root project ids for normalization', () => {
    const candidate = {
      projectId: 'p-primary',
      projectIds: [{ id: 'p-primary', name: '사업 A' }, { id: 'p-secondary', name: '사업 B' }],
      portalProfile: {
        projectId: 'p-primary',
        projectIds: ['p-primary', 'p-secondary'],
      },
    };

    const access = resolveMemberProjectAccessState(candidate);
    const workspace = readMemberWorkspace(candidate);

    expect(access.hasObjectRootProjectIds).toBe(true);
    expect(access.needsRootSync).toBe(true);
    expect(workspace.portalProfile?.projectIds).toEqual(['p-primary', 'p-secondary']);
  });
});
