import { describe, expect, it } from 'vitest';
import {
  buildDevHarnessPortalEntryContext,
  buildDevHarnessPortalOnboardingContext,
  buildDevHarnessPortalRegistrationResult,
  buildDevHarnessPortalSessionProjectResult,
} from './dev-harness-portal-api';

describe('dev harness portal api helpers', () => {
  it('builds a registered PM entry context with a visible start project', () => {
    const context = buildDevHarnessPortalEntryContext({ actorId: 'u002', actorRole: 'pm' });

    expect(context.registrationState).toBe('registered');
    expect(context.activeProjectId).toBeTruthy();
    expect(context.priorityProjectIds).toContain(context.activeProjectId);
    expect(context.projects.some((project) => project.id === context.activeProjectId)).toBe(true);
  });

  it('builds an admin entry context with multiple visible projects', () => {
    const context = buildDevHarnessPortalEntryContext({ actorId: 'u001', actorRole: 'admin' });

    expect(context.registrationState).toBe('registered');
    expect(context.projects.length).toBeGreaterThan(1);
  });

  it('builds onboarding context with visible projects', () => {
    const context = buildDevHarnessPortalOnboardingContext({ actorRole: 'pm' });

    expect(context.projects.length).toBeGreaterThan(0);
    expect(context.registrationState).toBe('registered');
  });

  it('normalizes registration payloads into a stable active project', () => {
    const result = buildDevHarnessPortalRegistrationResult({
      projectId: 'p001',
      projectIds: ['p001', 'p002', 'p001'],
    });

    expect(result).toEqual({
      ok: true,
      registrationState: 'registered',
      activeProjectId: 'p001',
      projectIds: ['p001', 'p002'],
    });
  });

  it('rejects session project switches for unknown projects', () => {
    expect(() => buildDevHarnessPortalSessionProjectResult('missing-project')).toThrow('project_not_found');
  });
});
