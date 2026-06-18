import { describe, expect, it } from 'vitest';

import { shouldHighlightProjectionAmountMismatch } from './cashflow-projection-cell-style';

describe('cashflow projection amount mismatch style', () => {
  it('highlights projection amount only when projection and actual are both non-zero and different', () => {
    expect(shouldHighlightProjectionAmountMismatch({ projection: 1000, actual: 2000 })).toBe(true);
    expect(shouldHighlightProjectionAmountMismatch({ projection: 1000, actual: 1000 })).toBe(false);
    expect(shouldHighlightProjectionAmountMismatch({ projection: 0, actual: 2000 })).toBe(false);
    expect(shouldHighlightProjectionAmountMismatch({ projection: 1000, actual: 0 })).toBe(false);
    expect(shouldHighlightProjectionAmountMismatch({ projection: 0, actual: 0 })).toBe(false);
  });
});
