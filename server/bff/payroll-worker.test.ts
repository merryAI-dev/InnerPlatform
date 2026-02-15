import { describe, expect, it } from 'vitest';
import {
  addMonthsToYearMonth,
  computePlannedPayDate,
  subtractBusinessDays,
} from './payroll-worker.mjs';

describe('payroll-worker dates', () => {
  it('clamps day-of-month to month end', () => {
    expect(computePlannedPayDate('2026-02', 31)).toBe('2026-02-28');
    expect(computePlannedPayDate('2024-02', 31)).toBe('2024-02-29');
  });

  it('subtractBusinessDays skips weekends', () => {
    // 2026-02-02 is Monday.
    expect(subtractBusinessDays('2026-02-02', 3)).toBe('2026-01-28');
  });

  it('addMonthsToYearMonth handles year boundary', () => {
    expect(addMonthsToYearMonth('2026-12', 1)).toBe('2027-01');
    expect(addMonthsToYearMonth('2026-01', -1)).toBe('2025-12');
  });
});

