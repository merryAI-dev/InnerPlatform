import { describe, expect, it } from 'vitest';

import { safeAmount, sumSafe } from './cashflow-amounts.mjs';

describe('cashflow amount boundary', () => {
  it('accepts only safe integer amounts without coercion', () => {
    expect(safeAmount(0)).toBe(0);
    expect(safeAmount(12_345)).toBe(12_345);
    expect(safeAmount(-12_345)).toBe(-12_345);

    for (const invalid of [
      null,
      undefined,
      '',
      '0',
      '12345',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      {},
      [],
    ]) {
      expect(safeAmount(invalid)).toBeNull();
    }
  });

  it('returns null instead of turning an invalid declared amount into zero', () => {
    expect(sumSafe([])).toBe(0);
    expect(sumSafe([1, 2, -3])).toBe(0);
    expect(sumSafe([1, null, 2])).toBeNull();
    expect(sumSafe([1, '2'])).toBeNull();
    expect(sumSafe([Number.MAX_SAFE_INTEGER, 1])).toBeNull();
  });
});
