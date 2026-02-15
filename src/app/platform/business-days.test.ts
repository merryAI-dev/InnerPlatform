import { describe, expect, it } from 'vitest';
import {
  addMonthsToYearMonth,
  clampDayOfMonth,
  computePlannedPayDate,
  daysInMonth,
  subtractBusinessDays,
} from './business-days';

describe('business-days', () => {
  it('subtractBusinessDays skips weekends (Mon - 3 business days = Wed prev week)', () => {
    // 2026-02-02 is Monday.
    expect(subtractBusinessDays('2026-02-02', 3)).toBe('2026-01-28');
  });

  it('daysInMonth handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('clampDayOfMonth clamps to last day of month', () => {
    expect(clampDayOfMonth(2026, 2, 31)).toBe(28);
    expect(clampDayOfMonth(2024, 2, 31)).toBe(29);
  });

  it('computePlannedPayDate clamps day-of-month', () => {
    expect(computePlannedPayDate('2026-02', 31)).toBe('2026-02-28');
    expect(computePlannedPayDate('2024-02', 31)).toBe('2024-02-29');
  });

  it('addMonthsToYearMonth carries year boundaries', () => {
    expect(addMonthsToYearMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToYearMonth('2026-01', -1)).toBe('2025-12');
  });
});

