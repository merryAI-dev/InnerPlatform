import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import {
  resolveActivePortalProjectId,
  resolvePortalProjectCandidates,
  resolvePortalProjectResourceId,
  resolvePortalProjectResourcePath,
  resolvePortalProjectSelectPath,
  resolvePortalProjectSwitchPath,
  runPortalProjectSwitch,
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
  it('lets PM portal users search the full project pool while keeping assigned projects prioritized', () => {
    const result = resolvePortalProjectCandidates({
      role: 'viewer',
      authUid: 'uid-pm',
      assignedProjectIds: ['p-assigned'],
      projects,
    });

    expect(result.priorityProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed']);
    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed', 'p-other']);
  });

  it('does not hide projects with inconsistent owner metadata from PM search', () => {
    const result = resolvePortalProjectCandidates({
      role: 'pm',
      authUid: 'owner-1',
      assignedProjectIds: [],
      projects: [
        { id: 'p-owner', name: 'Owner Project', registeredById: 'owner-1', managerId: 'legacy-other' },
        { id: 'p-legacy', name: 'Legacy Project', registeredById: 'other', managerId: 'owner-1' },
      ] as unknown as Project[],
    });

    expect(result.priorityProjects.map((project) => project.id)).toEqual(['p-legacy', 'p-owner']);
    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-legacy', 'p-owner']);
  });

  it('prioritizes projects where the user is the designated organization head', () => {
    const result = resolvePortalProjectCandidates({
      role: 'viewer',
      authUid: 'head-1',
      assignedProjectIds: [],
      projects: [
        { id: 'p-other', name: '다른 사업', executiveApproverId: 'head-2' },
        { id: 'p-head', name: '조직장 승인 사업', executiveApproverId: 'head-1' },
      ] as unknown as Project[],
    });

    expect(result.priorityProjects.map((project) => project.id)).toEqual(['p-head']);
    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-other', 'p-head']);
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

  it('does not expose trashed projects in portal selection', () => {
    const result = resolvePortalProjectCandidates({
      role: 'admin',
      projects: [
        ...projects,
        { id: 'p-trashed', name: 'Trashed Project', trashedAt: '2026-07-31T00:00:00.000Z' },
      ] as unknown as Project[],
    });

    expect(result.searchProjects.map((project) => project.id)).toEqual(['p-assigned', 'p-managed', 'p-other']);
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

  it('keeps project selection and switch targets explicit without falling back to /portal', () => {
    expect(resolvePortalProjectSelectPath('/portal')).toBe('/portal/project-select');
    expect(resolvePortalProjectSelectPath('/portal/budget')).toBe('/portal/project-select');
    expect(resolvePortalProjectSelectPath('/portal/project-select')).toBe('/portal/project-select');
    expect(resolvePortalProjectSelectPath('/portal/project-select?redirect=%2Fportal%2Fbudget')).toBe('/portal/project-select');
    expect(resolvePortalProjectSwitchPath('/portal/cashflow')).toBe('/portal/cashflow');
    expect(resolvePortalProjectSwitchPath('/portal')).toBe('/portal/budget');
    expect(resolvePortalProjectSwitchPath('/portal/project-select')).toBe('/portal/budget');
    expect(resolvePortalProjectSwitchPath('/portal/project-select?redirect=%2Fportal%2Fbudget')).toBe('/portal/budget');
  });

  it('gives the canonical route project precedence over session fallbacks', () => {
    expect(resolvePortalProjectResourceId('route-project', 'session-project', 'primary-project')).toBe('route-project');
    expect(resolvePortalProjectResourceId('', 'session-project', 'primary-project')).toBe('session-project');
    expect(resolvePortalProjectResourceId(undefined, '', 'primary-project')).toBe('primary-project');
  });

  it('replaces project IDs in canonical and legacy resource paths while preserving query and hash', () => {
    expect(resolvePortalProjectResourcePath('/portal/edit-project/old?tab=contract#top', 'new/project')).toBe(
      '/portal/edit-project/new%2Fproject?tab=contract#top',
    );
    expect(resolvePortalProjectResourcePath('/portal/cashflow/old', 'new-project')).toBe('/portal/cashflow/new-project');
    expect(resolvePortalProjectResourcePath('/portal/cashflow/old/sheets-lab?step=2', 'new-project')).toBe(
      '/portal/cashflow/new-project/sheets-lab?step=2',
    );
    expect(resolvePortalProjectResourcePath('/portal/cashflow/sheets-lab#review', 'new-project')).toBe(
      '/portal/cashflow/new-project/sheets-lab#review',
    );
    expect(resolvePortalProjectResourcePath('/portal/budget?month=2026-07', 'new-project')).toBe(
      '/portal/budget?month=2026-07',
    );
  });

  it('runs the dirty guard before state mutation and navigation', async () => {
    const blockedEvents: string[] = [];
    const blocked = await runPortalProjectSwitch({
      projectId: 'project-b',
      currentPath: '/portal/cashflow/project-a?month=2026-07',
      label: '캐시플로우',
      isNavigationBlocked: (attempt) => {
        blockedEvents.push(`guard:${attempt.path}`);
        return true;
      },
      setActiveProject: async () => {
        blockedEvents.push('set');
        return true;
      },
      navigate: () => blockedEvents.push('navigate'),
    });

    expect(blocked).toBe(false);
    expect(blockedEvents).toEqual(['guard:/portal/cashflow/project-b?month=2026-07']);

    const allowedEvents: string[] = [];
    const allowed = await runPortalProjectSwitch({
      projectId: 'project-b',
      currentPath: '/portal/cashflow/project-a/sheets-lab#review',
      label: '시트 연동 검토',
      isNavigationBlocked: (attempt) => {
        allowedEvents.push(`guard:${attempt.path}`);
        return false;
      },
      setActiveProject: async (projectId) => {
        allowedEvents.push(`set:${projectId}`);
        return true;
      },
      navigate: (path) => allowedEvents.push(`navigate:${path}`),
    });

    expect(allowed).toBe(true);
    expect(allowedEvents).toEqual([
      'guard:/portal/cashflow/project-b/sheets-lab#review',
      'set:project-b',
      'navigate:/portal/cashflow/project-b/sheets-lab#review',
    ]);
  });
});
