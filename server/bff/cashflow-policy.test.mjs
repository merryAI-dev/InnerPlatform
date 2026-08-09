import { describe, expect, it } from 'vitest';
import {
  CASHFLOW_ALL_LINES,
  CASHFLOW_IN_LINES,
  CASHFLOW_MONTH_CELL_COUNT,
  CASHFLOW_OUT_LINES,
} from './cashflow-policy.mjs';

describe('cashflow policy derivations', () => {
  it('derives the month cell count from the policy JSON line catalog', () => {
    // JVM CashflowLineCatalog.monthCellCount() 와 같은 값이어야 한다. JVM 쪽은
    // CashflowLineCatalogPolicyParityTest 가 같은 JSON 과 대조한다 - 라인이 추가되면
    // 양쪽이 함께 움직이고, 이 리터럴 표가 갱신을 강제한다.
    expect(CASHFLOW_IN_LINES).toHaveLength(7);
    expect(CASHFLOW_OUT_LINES).toHaveLength(9);
    expect(CASHFLOW_ALL_LINES).toHaveLength(16);
    expect(CASHFLOW_MONTH_CELL_COUNT).toBe(160);
    expect(CASHFLOW_MONTH_CELL_COUNT).toBe(CASHFLOW_ALL_LINES.length * 2 * 5);
  });
});
