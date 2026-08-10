import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'useCashflowProjectionActualSummaries.ts'), 'utf8');

describe('useCashflowProjectionActualSummaries', () => {
  it('uses bounded batches and preserves successful items when another batch fails', () => {
    expect(source).toContain('const BATCH_SIZE = 10');
    expect(source).toContain('await load(projectIds.slice(index, index + BATCH_SIZE), () => active)');
    expect(source).not.toContain('void load(projectIds.slice(index, index + BATCH_SIZE)');
    expect(source).toContain('mergeCashflowProjectionActualSummaryBatch(current, ids, response)');
    expect(source).toContain('summaries: {');
    expect(source).toContain('...current.summaries');
  });

  it('does not restart batches for an equivalent authenticated actor object', () => {
    expect(source).toContain('const stableActor = useMemo<ActorLike | null>');
    expect(source).toContain('actor: stableActor');
  });

  it('retries only the requested failed project', () => {
    expect(source).toContain('retry: (projectId: string) => load([projectId])');
    expect(source).toContain('[projectId, !returnedIds.has(projectId)]');
  });
});
