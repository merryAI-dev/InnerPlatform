import { describe, expect, it } from 'vitest';
import type { CashflowMonthCloseRevisionDiff } from '../../lib/platform-bff-client';
import { matchesCashflowMonthCloseRevisionDiff } from './CumulativeSettlementMonthDetails';

const request = {
  requestId: 'project-a-2026-08',
  revision: 2,
  throughMonth: '2026-07',
  lockRange: { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-07', throughWeekNo: 5 },
};

function result(overrides: Partial<CashflowMonthCloseRevisionDiff> = {}): CashflowMonthCloseRevisionDiff {
  return {
    requestId: request.requestId,
    yearMonth: request.throughMonth,
    currentRevision: request.revision,
    previousRevision: 1,
    changes: [],
    ...overrides,
  };
}

describe('matchesCashflowMonthCloseRevisionDiff', () => {
  it('accepts only the selected request revision and through-month response', () => {
    expect(matchesCashflowMonthCloseRevisionDiff(request, result())).toBe(true);
    expect(matchesCashflowMonthCloseRevisionDiff(request, result({ requestId: 'another-request' }))).toBe(false);
    expect(matchesCashflowMonthCloseRevisionDiff(request, result({ currentRevision: 1 }))).toBe(false);
    expect(matchesCashflowMonthCloseRevisionDiff(request, result({ yearMonth: '2026-08' }))).toBe(false);
    expect(matchesCashflowMonthCloseRevisionDiff({
      ...request,
      lockRange: { ...request.lockRange, throughMonth: '2026-06' },
    }, result())).toBe(false);
  });

  it('uses lockRange throughMonth for legacy responses without a top-level throughMonth', () => {
    expect(matchesCashflowMonthCloseRevisionDiff({ ...request, throughMonth: undefined }, result())).toBe(true);
  });
});
