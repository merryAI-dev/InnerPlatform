import { describe, expect, it } from 'vitest';
import { shouldApplyCashflowSheetLabProjectResult } from './cashflow-sheet-lab-project-scope';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('cashflow sheet lab project request scope', () => {
  it('drops a delayed project A response after the selected project changes to B', async () => {
    let selectedProjectId = 'project-a';
    let selectedSourceYear = 2026;
    let currentGeneration = 1;
    const response = deferred<string>();
    let visibleStatus = '';

    const settleResponse = response.promise.then((status) => {
      if (shouldApplyCashflowSheetLabProjectResult({
        requestGeneration: 1,
        currentGeneration,
        requestedProjectId: 'project-a',
        selectedProjectId,
        requestedSourceYear: 2026,
        selectedSourceYear,
      })) {
        visibleStatus = status;
      }
    });

    selectedProjectId = 'project-b';
    selectedSourceYear = 2027;
    currentGeneration += 1;
    response.resolve('project-a-applied');
    await settleResponse;

    expect(visibleStatus).toBe('');
  });

  it('accepts the latest response for the still-selected project', () => {
    expect(shouldApplyCashflowSheetLabProjectResult({
      requestGeneration: 3,
      currentGeneration: 3,
      requestedProjectId: 'project-a',
      selectedProjectId: 'project-a',
      requestedSourceYear: 2026,
      selectedSourceYear: 2026,
    })).toBe(true);
  });

  it('drops a response after the selected source year changes in the same project', () => {
    expect(shouldApplyCashflowSheetLabProjectResult({
      requestGeneration: 4,
      currentGeneration: 4,
      requestedProjectId: 'project-a',
      selectedProjectId: 'project-a',
      requestedSourceYear: 2026,
      selectedSourceYear: 2027,
    })).toBe(false);
  });
});
