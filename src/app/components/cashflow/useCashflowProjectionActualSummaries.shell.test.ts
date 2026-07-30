import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'useCashflowProjectionActualSummaries.ts'), 'utf8');

describe('useCashflowProjectionActualSummaries', () => {
  it('uses bounded batches and preserves successful items when another batch fails', () => {
    expect(source).toContain('const BATCH_SIZE = 10');
    expect(source).toContain('projectIds.slice(index, index + BATCH_SIZE)');
    expect(source).toContain('mergeCashflowProjectionActualSummaryBatch(current, ids, response)');
    expect(source).toContain('summaries: {');
    expect(source).toContain('...current.summaries');
  });

  it('retries only the requested failed project', () => {
    expect(source).toContain('retry: (projectId: string) => load([projectId])');
    expect(source).toContain('[projectId, !returnedIds.has(projectId)]');
  });
});
