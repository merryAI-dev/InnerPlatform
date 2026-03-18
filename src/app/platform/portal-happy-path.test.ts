import { describe, expect, it } from 'vitest';
import { resolvePortalHappyPath } from './portal-happy-path';

describe('resolvePortalHappyPath', () => {
  it('reports setup requirements when project assignment is missing', () => {
    const state = resolvePortalHappyPath({
      authUser: { role: 'pm', email: 'user@mysc.co.kr' },
      portalUser: { role: 'pm', projectIds: [] },
      project: null,
      ledgers: [],
    });

    expect(state.status).toBe('setup_required');
    expect(state.canOpenWeeklyExpenses).toBe(false);
    expect(state.canUseEvidenceWorkflow).toBe(false);
    expect(state.missingKeys).toEqual(['assignment', 'project']);
  });

  it('marks weekly expenses ready but evidence setup pending when drive root is missing', () => {
    const state = resolvePortalHappyPath({
      authUser: { role: 'pm', email: 'user@mysc.co.kr' },
      portalUser: { role: 'pm', projectId: 'p1', projectIds: ['p1'] },
      project: { id: 'p1', name: '테스트 사업' },
      ledgers: [],
    });

    expect(state.status).toBe('setup_required');
    expect(state.canOpenWeeklyExpenses).toBe(true);
    expect(state.canUseEvidenceWorkflow).toBe(false);
    expect(state.missingKeys).toEqual(['drive_root', 'evidence']);
  });

  it('closes the happy path once drive root is configured', () => {
    const state = resolvePortalHappyPath({
      authUser: { role: 'viewer', email: 'user@mysc.co.kr' },
      portalUser: { role: 'viewer', projectId: 'p1', projectIds: ['p1'] },
      project: {
        id: 'p1',
        name: '테스트 사업',
        evidenceDriveRootFolderId: 'folder-1',
        evidenceDriveRootFolderName: '테스트 사업_p1',
      },
      ledgers: [{ projectId: 'p1' }],
    });

    expect(state.status).toBe('ready');
    expect(state.canOpenWeeklyExpenses).toBe(true);
    expect(state.canUseEvidenceWorkflow).toBe(true);
    expect(state.missingKeys).toEqual([]);
    expect(state.steps.find((step) => step.key === 'evidence')?.status).toBe('complete');
  });
});
