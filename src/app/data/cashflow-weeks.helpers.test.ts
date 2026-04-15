import { describe, expect, it } from 'vitest';
import {
  filterCashflowWeeksForYear,
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
});
