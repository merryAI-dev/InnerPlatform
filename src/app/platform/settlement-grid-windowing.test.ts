import { describe, expect, it } from 'vitest';
import { computeSettlementGridWindowRange } from './settlement-grid-windowing';

describe('computeSettlementGridWindowRange', () => {
  it('returns the full range when viewport input is not usable', () => {
    expect(
      computeSettlementGridWindowRange({
        rowCount: 50,
        scrollTop: 0,
        viewportHeight: 0,
        rowHeightEstimate: 56,
        overscan: 8,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 50,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it('computes a padded visible row window', () => {
    expect(
      computeSettlementGridWindowRange({
        rowCount: 200,
        scrollTop: 560,
        viewportHeight: 560,
        rowHeightEstimate: 56,
        overscan: 4,
      }),
    ).toEqual({
      startIndex: 6,
      endIndex: 24,
      paddingTop: 336,
      paddingBottom: 9856,
    });
  });

  it('clamps the end of the range near the bottom', () => {
    expect(
      computeSettlementGridWindowRange({
        rowCount: 30,
        scrollTop: 1456,
        viewportHeight: 560,
        rowHeightEstimate: 56,
        overscan: 6,
      }),
    ).toEqual({
      startIndex: 20,
      endIndex: 30,
      paddingTop: 1120,
      paddingBottom: 0,
    });
  });
});
