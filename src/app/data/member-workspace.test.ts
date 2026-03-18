import { describe, expect, it } from 'vitest';
import {
  buildPortalProfilePatch,
  buildWorkspacePreferencePatch,
  readMemberWorkspace,
} from './member-workspace';

describe('member workspace helpers', () => {
  it('reads legacy root project fields into portal profile', () => {
    const workspace = readMemberWorkspace({
      projectId: 'p-001',
      projectIds: ['p-001', 'p-002'],
    });

    expect(workspace.portalProfile).toEqual({
      projectId: 'p-001',
      projectIds: ['p-001', 'p-002'],
    });
  });

  it('prefers explicit portal profile and keeps project names', () => {
    const workspace = readMemberWorkspace({
      defaultWorkspace: 'portal',
      portalProfile: {
        projectId: 'p-002',
        projectIds: ['p-002', 'p-003'],
        projectNames: {
          'p-002': 'Beta',
          'p-003': 'Gamma',
        },
      },
      projectId: 'p-001',
      projectIds: ['p-001'],
    });

    expect(workspace.defaultWorkspace).toBe('portal');
    expect(workspace.portalProfile).toEqual({
      projectId: 'p-002',
      projectIds: ['p-001', 'p-002', 'p-003'],
      projectNames: {
        'p-002': 'Beta',
        'p-003': 'Gamma',
      },
    });
  });

  it('builds portal patch with legacy root fields kept in sync', () => {
    expect(buildPortalProfilePatch({
      projectId: 'p-010',
      projectIds: ['p-011', 'p-010'],
      projectNames: { 'p-010': 'Delta' },
      updatedAt: '2026-03-10T00:00:00.000Z',
      updatedByUid: 'u-admin',
      updatedByName: 'Admin',
    })).toEqual({
      defaultWorkspace: 'portal',
      lastWorkspace: 'portal',
      updatedAt: '2026-03-10T00:00:00.000Z',
      projectId: 'p-010',
      projectIds: ['p-011', 'p-010'],
      portalProfile: {
        projectId: 'p-010',
        projectIds: ['p-011', 'p-010'],
        projectNames: { 'p-010': 'Delta' },
        updatedAt: '2026-03-10T00:00:00.000Z',
        updatedByUid: 'u-admin',
        updatedByName: 'Admin',
      },
    });
  });

  it('builds a workspace-only preference patch', () => {
    expect(buildWorkspacePreferencePatch('admin', '2026-03-10T00:00:00.000Z', false)).toEqual({
      lastWorkspace: 'admin',
      updatedAt: '2026-03-10T00:00:00.000Z',
    });
  });
});
