import { describe, expect, it } from 'vitest';
import {
  resolvePortalEntryMemberAccess,
  resolvePortalEntryRegistrationState,
  selectPortalEntryProjects,
} from './portal-entry.mjs';

describe('portal entry route helpers', () => {
  it('normalizes root and portal profile project ids into a single active selection', () => {
    expect(resolvePortalEntryMemberAccess({
      projectId: 'p-root',
      projectIds: [{ id: 'p-root' }, 'p-shared'],
      portalProfile: {
        projectId: 'p-shared',
        projectIds: ['p-shared', 'p-portal'],
      },
    })).toEqual({
      projectIds: ['p-root', 'p-shared', 'p-portal'],
      activeProjectId: 'p-shared',
    });
  });

  it('treats admin and finance operators as registered even without a member doc', () => {
    expect(resolvePortalEntryRegistrationState({
      role: 'admin',
      memberExists: false,
      projectIds: [],
    })).toBe('registered');
    expect(resolvePortalEntryRegistrationState({
      role: 'finance',
      memberExists: false,
      projectIds: [],
    })).toBe('registered');
  });

  it('keeps PM visibility scoped to assigned and managed projects', () => {
    const result = selectPortalEntryProjects({
      role: 'pm',
      actorId: 'uid-pm',
      memberProjectIds: ['p-assigned'],
      projects: [
        { id: 'p-assigned', name: 'Assigned', managerId: 'uid-other', status: 'IN_PROGRESS' },
        { id: 'p-managed', name: 'Managed', managerId: 'uid-pm', status: 'IN_PROGRESS' },
        { id: 'p-other', name: 'Other', managerId: 'uid-other', status: 'IN_PROGRESS' },
      ],
    });

    expect(result.projects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
    expect(result.priorityProjectIds).toEqual(['p-assigned', 'p-managed']);
  });
});
