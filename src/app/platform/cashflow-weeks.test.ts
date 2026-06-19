import { describe, expect, it } from 'vitest';
import { findWeekForDate, getMonthMondayWeeks, getYearMondayWeeks, isYearMonth, resolveFinanceWeekForDate } from './cashflow-weeks';

describe('cashflow week buckets (finance month policy)', () => {
  it('validates YYYY-MM inputs', () => {
    expect(isYearMonth('2026-01')).toBe(true);
    expect(isYearMonth('2026-1')).toBe(false);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('')).toBe(false);
    expect(isYearMonth(null)).toBe(false);
  });

  it('computes January 2026 as 5 Monday-based finance weeks', () => {
    const weeks = getMonthMondayWeeks('2026-01');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-01-01',
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-1-1', '26-1-2', '26-1-3', '26-1-4', '26-1-5']);
    expect(weeks[0]).toMatchObject({ yearMonth: '2026-01', weekNo: 1, weekEnd: '2026-01-04' });
    expect(weeks[4]).toMatchObject({ weekNo: 5, weekEnd: '2026-01-31' });
  });

  it('computes every month as 5 finance weeks for cashflow slots', () => {
    const weeks = getMonthMondayWeeks('2026-03');
    expect(weeks.map((w) => w.weekStart)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-09',
      '2026-03-16',
      '2026-03-23',
    ]);
    expect(weeks.map((w) => w.label)).toEqual(['26-3-1', '26-3-2', '26-3-3', '26-3-4', '26-3-5']);
    expect(weeks[4]).toMatchObject({ weekNo: 5, weekEnd: '2026-03-31' });
  });

  it('resolves required stage/live finance week boundary dates without environment branching', () => {
    expect(resolveFinanceWeekForDate('2026-06-29')).toMatchObject({
      financeYear: 2026,
      financeMonth: 6,
      rawWeek: 5,
      financeWeek: 5,
      yearMonth: '2026-06',
      weekNo: 5,
      label: '26-6-5',
    });
    expect(resolveFinanceWeekForDate('2026-07-01')).toMatchObject({
      financeYear: 2026,
      financeMonth: 7,
      rawWeek: 1,
      financeWeek: 1,
      yearMonth: '2026-07',
      weekNo: 1,
      label: '26-7-1',
    });
    expect(resolveFinanceWeekForDate('2026-08-31')).toMatchObject({
      financeYear: 2026,
      financeMonth: 8,
      rawWeek: 6,
      financeWeek: 5,
      yearMonth: '2026-08',
      weekNo: 5,
      label: '26-8-5',
      weekStart: '2026-08-24',
      weekEnd: '2026-08-31',
    });
  });

  it('finds dates by their own finance month even when adjacent month ranges overlap', () => {
    const weeks = getYearMondayWeeks(2026);
    expect(findWeekForDate('2026-06-29', weeks)).toMatchObject({ yearMonth: '2026-06', weekNo: 5 });
    expect(findWeekForDate('2026-07-01', weeks)).toMatchObject({ yearMonth: '2026-07', weekNo: 1 });
    expect(findWeekForDate('2026-08-31', weeks)).toMatchObject({ yearMonth: '2026-08', weekNo: 5, rawWeek: 6 });
  });

  it('returns empty for invalid yearMonth', () => {
    expect(getMonthMondayWeeks('invalid')).toEqual([]);
    expect(getMonthMondayWeeks('2026-00')).toEqual([]);
  });
});
