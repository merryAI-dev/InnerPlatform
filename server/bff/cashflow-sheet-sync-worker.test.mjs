import { describe, expect, it, vi } from 'vitest';
import {
  assertCashflowSheetSyncComplete,
  runCashflowSheetSyncWorker,
} from './cashflow-sheet-sync-worker.mjs';

function projectDoc(id, data) {
  return { id, data: () => ({ id, ...data }) };
}

function createDb(projects) {
  return {
    collection: vi.fn((path) => {
      expect(path).toBe('orgs/mysc/projects');
      return {
        get: vi.fn(async () => ({ docs: projects })),
      };
    }),
  };
}

describe('cashflow sheet sync worker', () => {
  it('processes every connected project with bounded concurrency and isolates failures', async () => {
    const db = createDb([
      projectDoc('project-a', { cashflowSheetLab: { value: 'sheet-a' } }),
      projectDoc('project-b', { cashflowSheetLabSources: { 2026: { value: 'sheet-b' } } }),
      projectDoc('project-c', { cashflowSheetLab: { value: 'sheet-c' } }),
      projectDoc('project-without-sheet', {}),
    ]);
    let active = 0;
    let maxActive = 0;
    const syncProject = vi.fn(async ({ projectId }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (projectId === 'project-b') throw Object.assign(new Error('sheet denied'), { code: 'sheet_denied' });
      return projectId === 'project-a'
        ? { classification: 'ALL_SYNCED', comparisons: { sheetToJvm: { changeCount: 0 } } }
        : { classification: 'SHEET_DIFFERS', comparisons: { sheetToJvm: { changeCount: 3 } } };
    });

    const result = await runCashflowSheetSyncWorker(db, {
      tenantId: 'mysc',
      concurrency: 2,
      syncProject,
      runId: 'cashflow-sheet-sync:2026-08-06',
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(syncProject).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      discoveredProjects: 3,
      processedProjects: 3,
      succeededProjects: 2,
      failedProjects: 1,
      changedCount: 3,
      appliedCount: 0,
      noChangeProjects: 1,
      failures: [{ projectId: 'project-b', code: 'sheet_denied' }],
    });
    expect(syncProject.mock.calls.every(([input]) => !Object.hasOwn(input, 'apply'))).toBe(true);
    expect(result.discoveredProjects).toBe(result.processedProjects);
  });

  it('rejects a partial worker result instead of reporting success', async () => {
    expect(() => assertCashflowSheetSyncComplete(2, 1))
      .toThrow(expect.objectContaining({ code: 'cashflow_sheet_sync_partial_forbidden' }));
  });
});
