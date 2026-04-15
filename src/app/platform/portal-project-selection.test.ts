import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  resolveActivePortalProjectId,
  resolvePortalProjectCandidates,
  resolvePortalProjectSelectPath,
  serializePortalProjectScope,
  resolvePortalProjectSwitchPath,
} from './portal-project-selection';

const projects = [
  {
    id: 'p-assigned',
    name: 'Alpha Project',
    managerId: 'uid-other',
  },
  {
    id: 'p-managed',
    name: 'Beta Project',
    managerId: 'uid-pm',
  },
  {
    id: 'p-other',
    name: 'Gamma Project',
    managerId: 'uid-else',
  },
] as unknown as Project[];

describe('portal project selection helpers', () => {
  it('resolves PM candidates from assigned and manager-owned projects and normalizes viewer to PM', () => {
    const result = resolvePortalProjectCandidates({
      role: 'viewer',
      authUid: 'uid-pm',
      assignedProjectIds: ['p-assigned'],
      projects,
    });

    expect(result.priorityProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
  });

  it('lets admin and finance search the full project pool', () => {
    const adminResult = resolvePortalProjectCandidates({
      role: 'admin',
      authUid: 'uid-admin',
      assignedProjectIds: [],
      projects,
    });
    const financeResult = resolvePortalProjectCandidates({
      role: 'finance',
      authUid: 'uid-finance',
      assignedProjectIds: ['p-assigned'],
      projects,
    });

    expect(adminResult.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed', 'p-other']);
    expect(financeResult.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed', 'p-other']);
  });

  it('falls back from active project to primary and then the first candidate', () => {
    expect(resolveActivePortalProjectId({
      activeProjectId: 'missing-project',
      primaryProjectId: 'p-assigned',
      candidateProjectIds: ['p-assigned', 'p-managed'],
    })).toBe('p-assigned');

    expect(resolveActivePortalProjectId({
      activeProjectId: '',
      primaryProjectId: '',
      candidateProjectIds: ['p-managed', 'p-assigned'],
    })).toBe('p-managed');
  });

  it('wraps portal routes for project selection and preserves current work routes on switch', () => {
    expect(resolvePortalProjectSelectPath('/portal/budget')).toBe('/portal/project-select?redirect=%2Fportal%2Fbudget');
    expect(resolvePortalProjectSelectPath('/portal/project-select')).toBe('/portal/project-select');
    expect(resolvePortalProjectSelectPath('/portal/project-select?redirect=%2Fportal%2Fbudget')).toBe('/portal/project-select?redirect=%2Fportal%2Fbudget');
    expect(resolvePortalProjectSwitchPath('/portal/cashflow')).toBe('/portal/cashflow');
    expect(resolvePortalProjectSwitchPath('/portal/project-select')).toBe('/portal');
    expect(resolvePortalProjectSwitchPath('/portal/project-select?redirect=%2Fportal%2Fbudget')).toBe('/portal');
  });

  it('serializes project scope from ids only so unrelated project metadata churn does not change the scope key', () => {
    const initialScope = serializePortalProjectScope([' p-assigned ', 'p-managed', 'p-assigned']);
    const sameIdsDifferentObjects = serializePortalProjectScope(['p-managed', 'p-assigned']);
    const changedScope = serializePortalProjectScope(['p-managed', 'p-other']);

    expect(initialScope).toBe('p-assigned|p-managed');
    expect(sameIdsDifferentObjects).toBe('p-assigned|p-managed');
    expect(changedScope).toBe('p-managed|p-other');
    expect(initialScope).not.toBe(changedScope);
  });
});
