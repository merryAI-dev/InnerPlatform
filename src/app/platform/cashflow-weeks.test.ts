import { describe, expect, it } from 'vitest';
import { getMonthMondayWeeks, isYearMonth } from './cashflow-weeks';

describe('cashflow week buckets (month Mondays)', () => {
  it('validates YYYY-MM inputs', () => {
    expect(isYearMonth('2026-01')).toBe(true);
    expect(isYearMonth('2026-1')).toBe(false);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('')).toBe(false);
    expect(isYearMonth(null)).toBe(false);
  });

  it('computes January 2026 as 4 Monday weeks', () => {
    const weeks = getMonthMondayWeeks('2026-01');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-1-1', '26-1-2', '26-1-3', '26-1-4']);
    expect(weeks[0]).toMatchObject({ yearMonth: '2026-01', weekNo: 1, weekEnd: '2026-01-11' });
    expect(weeks[3]).toMatchObject({ weekNo: 4, weekEnd: '2026-02-01' });
  });

  it('computes March 2026 as 5 Monday weeks', () => {
    const weeks = getMonthMondayWeeks('2026-03');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
      '2026-03-30',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-3-1', '26-3-2', '26-3-3', '26-3-4', '26-3-5']);
  });

  it('returns empty for invalid yearMonth', () => {
    expect(getMonthMondayWeeks('invalid')).toEqual([]);
    expect(getMonthMondayWeeks('2026-00')).toEqual([]);
  });
});

