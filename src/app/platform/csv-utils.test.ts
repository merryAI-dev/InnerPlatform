import { describe, expect, it } from 'vitest';
import { parseDate } from './csv-utils';

describe('csv-utils parseDate', () => {
  it('parses ISO and short year-first dates', () => {
    expect(parseDate('2026-03-19')).toBe('2026-03-19');
    expect(parseDate('26-03-19')).toBe('2026-03-19');
  });

  it('parses US-style month/day/year dates used by bank exports', () => {
    expect(parseDate('12/31/25')).toBe('2025-12-31');
    expect(parseDate('1/4/26')).toBe('2026-01-04');
    expect(parseDate('03/19/2026')).toBe('2026-03-19');
  });

  it('rejects invalid calendar dates', () => {
    expect(parseDate('12/32/25')).toBe('');
    expect(parseDate('2026-02-30')).toBe('');
  });
});
