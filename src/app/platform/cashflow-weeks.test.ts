import { describe, expect, it } from 'vitest';
import { getMonthMondayWeeks, isYearMonth } from './cashflow-weeks';

describe('cashflow week buckets (Wednesday-based)', () => {
  it('validates YYYY-MM inputs', () => {
    expect(isYearMonth('2026-01')).toBe(true);
    expect(isYearMonth('2026-1')).toBe(false);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('')).toBe(false);
    expect(isYearMonth(null)).toBe(false);
  });

  it('computes January 2026 as 5 Wednesday-based weeks', () => {
    const weeks = getMonthMondayWeeks('2026-01');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2025-12-31',
      '2026-01-07',
      '2026-01-14',
      '2026-01-21',
      '2026-01-28',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-1-1', '26-1-2', '26-1-3', '26-1-4', '26-1-5']);
    expect(weeks[0]).toMatchObject({ yearMonth: '2026-01', weekNo: 1, weekEnd: '2026-01-06' });
    expect(weeks[4]).toMatchObject({ weekNo: 5, weekEnd: '2026-02-03' });
  });

  it('computes March 2026 as 4 Wednesday-based weeks', () => {
    const weeks = getMonthMondayWeeks('2026-03');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-03-04',
      '2026-03-11',
      '2026-03-18',
      '2026-03-25',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-3-1', '26-3-2', '26-3-3', '26-3-4']);
  });

  it('returns empty for invalid yearMonth', () => {
    expect(getMonthMondayWeeks('invalid')).toEqual([]);
    expect(getMonthMondayWeeks('2026-00')).toEqual([]);
  });
});
