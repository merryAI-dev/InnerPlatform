import { describe, expect, it } from 'vitest';
import {
  cashflowWeeklyCompletionKey,
  filterCashflowWeeksThroughSelectedYear,
  filterCashflowWeeksForYear,
  isCashflowWeeklySettlementCompleted,
  resolveFirestoreErrorCode,
  shouldCreateDocOnUpdateError,
} from './cashflow-weeks.helpers';

describe('cashflow weeks helpers', () => {
  it('resolves firestore error codes', () => {
    expect(resolveFirestoreErrorCode({ code: 'not-found' })).toBe('not-found');
    expect(resolveFirestoreErrorCode({ code: 123 })).toBe('');
    expect(resolveFirestoreErrorCode(null)).toBe('');
  });

  it('creates docs only when update failed due to missing document', () => {
    expect(shouldCreateDocOnUpdateError({ code: 'not-found' })).toBe(true);
    expect(shouldCreateDocOnUpdateError({ code: 'permission-denied' })).toBe(false);
    expect(shouldCreateDocOnUpdateError({})).toBe(false);
  });

  it('filters cashflow weeks to the requested year on the client', () => {
    const rows = [
      { id: 'a', projectId: 'p1', yearMonth: '2025-12', weekNo: 5 },
      { id: 'b', projectId: 'p1', yearMonth: '2026-01', weekNo: 1 },
      { id: 'c', projectId: 'p1', yearMonth: '2026-08', weekNo: 2 },
      { id: 'd', projectId: 'p1', yearMonth: '2027-01', weekNo: 1 },
    ] as any[];

    expect(filterCashflowWeeksForYear(rows, '2026-04')).toEqual([
      { id: 'b', projectId: 'p1', yearMonth: '2026-01', weekNo: 1 },
      { id: 'c', projectId: 'p1', yearMonth: '2026-08', weekNo: 2 },
    ]);
  });

  it('keeps prior-year weeks for opening balance carry-forward', () => {
    const rows = [
      { id: 'a', projectId: 'p1', yearMonth: '2025-12', weekNo: 5 },
      { id: 'b', projectId: 'p1', yearMonth: '2026-12', weekNo: 5 },
      { id: 'c', projectId: 'p1', yearMonth: '2027-01', weekNo: 1 },
      { id: 'd', projectId: 'p1', yearMonth: '2028-01', weekNo: 1 },
    ] as any[];

    expect(filterCashflowWeeksThroughSelectedYear(rows, '2027-01')).toEqual([
      { id: 'a', projectId: 'p1', yearMonth: '2025-12', weekNo: 5 },
      { id: 'b', projectId: 'p1', yearMonth: '2026-12', weekNo: 5 },
      { id: 'c', projectId: 'p1', yearMonth: '2027-01', weekNo: 1 },
    ]);
  });

  it('uses only locked weekly settlement records as completed', () => {
    expect(isCashflowWeeklySettlementCompleted({ status: 'LOCKED', completedAt: '2026-07-03T00:00:00Z' })).toBe(true);
    expect(isCashflowWeeklySettlementCompleted({ status: 'OPEN', completedAt: '2026-07-03T00:00:00Z' })).toBe(false);
    expect(isCashflowWeeklySettlementCompleted({ completedAt: '2026-07-03T00:00:00Z' })).toBe(true);
    expect(cashflowWeeklyCompletionKey({ projectId: 'p1', yearMonth: '2026-07', weekNo: 2 })).toBe('p1:2026-07:2');
  });
});
