import { describe, expect, it } from 'vitest';
import { formatKoreanWonCompact } from './korean-money';

describe('formatKoreanWonCompact', () => {
  it('keeps 억 and 만 units in their correct positions', () => {
    expect(formatKoreanWonCompact(203_000_000)).toBe('2억 300만');
    expect(formatKoreanWonCompact(20_300_000)).toBe('2,030만');
    expect(formatKoreanWonCompact(-203_000_000)).toBe('-2억 300만');
  });

  it('preserves the won remainder instead of silently rounding it away', () => {
    expect(formatKoreanWonCompact(203_005_000)).toBe('2억 300만 5,000');
    expect(formatKoreanWonCompact(0)).toBe('0');
  });
});
