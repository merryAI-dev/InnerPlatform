import { describe, expect, it } from 'vitest';
import { SETTLEMENT_TYPE_LABELS } from './types';

describe('settlement type labels', () => {
  it('uses the global Type3 wording in business-readable order', () => {
    expect(SETTLEMENT_TYPE_LABELS.TYPE3).toBe('Type3. 세금계산서 미발행 + 공급가액');
  });
});
