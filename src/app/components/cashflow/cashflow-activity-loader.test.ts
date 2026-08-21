import { describe, expect, it, vi } from 'vitest';
import * as activityLoader from './cashflow-activity-loader';
import {
  createCashflowActivityRequestGuard,
  shouldStartCashflowActivityLoad,
  updateCashflowActivityCursorQueue,
} from './cashflow-activity-loader';

function cashflowActivitySourcesForMutations() {
  expect(activityLoader).toHaveProperty('cashflowActivitySourcesForMutations');
  return (activityLoader as typeof activityLoader & {
    cashflowActivitySourcesForMutations: (mutations: string[]) => string[];
  }).cashflowActivitySourcesForMutations;
}

function takeCashflowActivityPendingWork() {
  expect(activityLoader).toHaveProperty('takeCashflowActivityPendingWork');
  return (activityLoader as typeof activityLoader & {
    takeCashflowActivityPendingWork: (
      state: {
        scope: string;
        depth: number;
        pendingAggregate: boolean;
        pendingSources: Set<'sheet_refresh' | 'audit'>;
      },
      input: { scope: string; visible: boolean; busy: boolean },
    ) => { kind: 'aggregate' } | { kind: 'sources'; sources: Array<'sheet_refresh' | 'audit'> } | null;
  }).takeCashflowActivityPendingWork;
}

function filterCashflowActivityErrorsAfterSuccess() {
  expect(activityLoader).toHaveProperty('filterCashflowActivityErrorsAfterSuccess');
  return (activityLoader as typeof activityLoader & {
    filterCashflowActivityErrorsAfterSuccess: <T extends {
      source: 'sheet_refresh' | 'audit';
      preservePagination?: boolean;
    }>(
      failures: T[],
      source: 'sheet_refresh' | 'audit',
      preservePagination: boolean,
    ) => T[];
  }).filterCashflowActivityErrorsAfterSuccess;
}

describe('cashflow activity request guard', () => {
  it('aborts superseded lanes and rejects every ticket from an invalidated project generation', () => {
    const guard = createCashflowActivityRequestGuard();
    const aggregate = guard.start('aggregate', { reset: true });
    const audit = guard.start('source:audit');
    const replacementAudit = guard.start('source:audit');

    expect(aggregate.signal.aborted).toBe(false);
    expect(audit.signal.aborted).toBe(true);
    expect(guard.isCurrent(audit)).toBe(false);
    expect(guard.isCurrent(replacementAudit)).toBe(true);

    guard.invalidate();

    expect(aggregate.signal.aborted).toBe(true);
    expect(replacementAudit.signal.aborted).toBe(true);
    expect(guard.isCurrent(aggregate)).toBe(false);
    expect(guard.isGenerationCurrent(replacementAudit.generation)).toBe(false);
  });

  it('keeps independent aggregate and source-retry lanes alive in the same generation', () => {
    const guard = createCashflowActivityRequestGuard();
    const aggregate = guard.start('aggregate', { reset: true });
    const audit = guard.start('source:audit');

    expect(guard.isCurrent(aggregate)).toBe(true);
    expect(guard.isCurrent(audit)).toBe(true);

    guard.finish(audit);
    expect(guard.isCurrent(audit)).toBe(false);
    expect(guard.isCurrent(aggregate)).toBe(true);
  });
});

describe('cashflow activity paging policy', () => {
  it('queues the aggregate cursor and a recovered source cursor without losing either continuation', () => {
    const aggregate = updateCashflowActivityCursorQueue([], undefined, 'aggregate-page-2');
    const withAudit = updateCashflowActivityCursorQueue(aggregate, 'audit', 'audit-page-2');

    expect(withAudit).toEqual([
      { cursor: 'aggregate-page-2' },
      { source: 'audit', cursor: 'audit-page-2' },
    ]);
    expect(updateCashflowActivityCursorQueue(withAudit, undefined, null)).toEqual([
      { source: 'audit', cursor: 'audit-page-2' },
    ]);
  });

  it('keeps the aggregate cursor authoritative when a mutation head page returns its own cursor', () => {
    const aggregate = updateCashflowActivityCursorQueue([], undefined, 'aggregate-page-2');
    const updateWithPolicy = updateCashflowActivityCursorQueue as typeof updateCashflowActivityCursorQueue & (
      (
        current: typeof aggregate,
        source: 'audit',
        cursor: string,
        options: { preserveExisting: boolean },
      ) => typeof aggregate
    );

    const afterMutationHead = updateWithPolicy(
      aggregate,
      'audit',
      'audit-head-page-2',
      { preserveExisting: true },
    );

    expect(afterMutationHead).toBe(aggregate);
    expect(afterMutationHead).toEqual([{ cursor: 'aggregate-page-2' }]);
  });

  it('does not hide an aggregate history gap when a mutation head refresh succeeds', () => {
    const filterAfterSuccess = filterCashflowActivityErrorsAfterSuccess();
    const aggregateGap = { source: 'audit' as const, message: '이전 기록을 불러오지 못했습니다.' };
    const mutationHeadFailure = {
      source: 'audit' as const,
      message: '최신 기록을 불러오지 못했습니다.',
      preservePagination: true,
    };

    expect(filterAfterSuccess([aggregateGap], 'audit', true)).toEqual([aggregateGap]);
    expect(filterAfterSuccess([mutationHeadFailure], 'audit', true)).toEqual([]);
    expect(filterAfterSuccess([aggregateGap], 'audit', false)).toEqual([]);
  });

  it('starts no request while hidden, deferred, or scoped to a stale project', () => {
    const fetchPage = vi.fn();
    const attempts = [
      { visible: false, deferred: false, currentScope: true },
      { visible: true, deferred: true, currentScope: true },
      { visible: true, deferred: false, currentScope: false },
      { visible: true, deferred: false, currentScope: true },
    ];

    attempts.forEach((attempt) => {
      if (shouldStartCashflowActivityLoad(attempt)) fetchPage();
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('cashflow activity mutation source policy', () => {
  it('reloads only the Activity collection that the completed mutation actually changed', () => {
    const sourcesFor = cashflowActivitySourcesForMutations();

    expect(sourcesFor(['sheet_mirror_refreshed'])).toEqual(['sheet_refresh']);
    expect(sourcesFor(['sheet_values_applied'])).toEqual(['audit']);
    expect(sourcesFor(['month_reopen_completed'])).toEqual(['audit']);
    expect(sourcesFor(['month_close_requested'])).toEqual([]);
    expect(sourcesFor(['month_close_withdrawn'])).toEqual([]);
    expect(sourcesFor(['month_close_approver_changed'])).toEqual([]);
  });

  it('deduplicates one-click refresh and apply into at most two bounded source pages', () => {
    const sourcesFor = cashflowActivitySourcesForMutations();

    expect(sourcesFor(['sheet_mirror_refreshed'])).toEqual(['sheet_refresh']);
    const completed = sourcesFor([
      'sheet_mirror_refreshed',
      'sheet_values_applied',
      'sheet_values_applied',
    ]);
    expect(completed).toEqual(['sheet_refresh', 'audit']);
    expect(completed.length * 50).toBeLessThanOrEqual(100);
  });

  it('keeps deferred aggregate work queued and lets it absorb mutation source pages once idle', () => {
    const takePendingWork = takeCashflowActivityPendingWork();
    const state = {
      scope: 'org-a:project-a',
      depth: 1,
      pendingAggregate: true,
      pendingSources: new Set(['sheet_refresh', 'audit'] as const),
    };

    expect(takePendingWork(state, {
      scope: 'org-a:project-a', visible: true, busy: false,
    })).toBeNull();
    expect(state.pendingAggregate).toBe(true);
    expect([...state.pendingSources]).toEqual(['sheet_refresh', 'audit']);

    state.depth = 0;
    expect(takePendingWork(state, {
      scope: 'org-a:project-a', visible: true, busy: false,
    })).toEqual({ kind: 'aggregate' });
    expect(state.pendingAggregate).toBe(false);
    expect([...state.pendingSources]).toEqual([]);
    expect(takePendingWork(state, {
      scope: 'org-a:project-a', visible: true, busy: false,
    })).toBeNull();
  });

  it('drains only the completed mutation sources when no aggregate load is pending', () => {
    const takePendingWork = takeCashflowActivityPendingWork();
    const state = {
      scope: 'org-a:project-a',
      depth: 0,
      pendingAggregate: false,
      pendingSources: new Set(['sheet_refresh', 'audit'] as const),
    };

    expect(takePendingWork(state, {
      scope: 'org-a:project-a', visible: true, busy: false,
    })).toEqual({ kind: 'sources', sources: ['sheet_refresh', 'audit'] });
    expect([...state.pendingSources]).toEqual([]);
  });

  it('never drains pending activity from a stale project scope', () => {
    const takePendingWork = takeCashflowActivityPendingWork();
    const state = {
      scope: 'org-a:project-a',
      depth: 0,
      pendingAggregate: true,
      pendingSources: new Set(['audit'] as const),
    };

    expect(takePendingWork(state, {
      scope: 'org-a:project-b', visible: true, busy: false,
    })).toBeNull();
    expect(state.pendingAggregate).toBe(true);
    expect([...state.pendingSources]).toEqual(['audit']);
  });
});
