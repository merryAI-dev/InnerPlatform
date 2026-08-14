import { describe, expect, it } from 'vitest';
import {
  CASHFLOW_MANAGEMENT_CHECK_IDS,
  CASHFLOW_MANAGEMENT_CHECK_STATUSES,
  laborTransferCheck,
  matchingManagementChecks,
  negativeProjectionCheck,
  validManagementConfirmations,
} from './cashflow-management-checks.mjs';

describe('cashflow management checks', () => {
  it('pins the check id and status vocabulary to the JVM pattern (parity table)', () => {
    // JVM CloseCashflowMonthRequest 의 @Pattern 이 정확히 이 어휘를 강제한다
    // (CloseCashflowMonthRequestTest.managementCheckVocabularyMatchesTheBffParityTable).
    // 한쪽이 검사를 추가/개명하면 확정이 400 으로 거부되므로, 양쪽 표를 함께 고쳐야 한다.
    expect(CASHFLOW_MANAGEMENT_CHECK_IDS).toEqual([
      'labor-transfer',
      'profit-vat-after-deposit',
      'negative-projection-balance',
      'future-prepay-over-million',
    ]);
    expect(CASHFLOW_MANAGEMENT_CHECK_STATUSES).toEqual(['OK', 'WARNING', 'REVIEW_REQUIRED']);
  });

  it('flags unentered week-3 labor as WARNING and zero-planned as REVIEW_REQUIRED', () => {
    const empty = laborTransferCheck([], new Map(), '2026-07');
    expect(empty).toMatchObject({ id: 'labor-transfer', status: 'WARNING' });

    const zeroPlanned = laborTransferCheck([], new Map([
      ['2026-07:projection:3:MYSC_LABOR_OUT', { cellState: 'ZERO', amount: 0 }],
    ]), '2026-07');
    expect(zeroPlanned).toMatchObject({ id: 'labor-transfer', status: 'REVIEW_REQUIRED' });

    const transferred = laborTransferCheck([], new Map([
      ['2026-07:projection:3:MYSC_LABOR_OUT', { cellState: 'VALUE', amount: 1_000_000 }],
      ['2026-07:actual:3:MYSC_LABOR_OUT', { cellState: 'VALUE', amount: 1_000_000 }],
    ]), '2026-07');
    expect(transferred).toMatchObject({ id: 'labor-transfer', status: 'OK' });
  });

  it('accumulates the projection balance across weeks including the opening balance', () => {
    const weeks = [
      { yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: 100, DIRECT_COST_OUT: 300 } },
      { yearMonth: '2026-07', weekNo: 2, projection: { SALES_IN: 500 } },
    ];
    expect(negativeProjectionCheck(weeks, 100)).toMatchObject({ status: 'WARNING' });
    expect(negativeProjectionCheck(weeks, 200)).toMatchObject({ status: 'OK' });
  });

  it('keeps sparse lines at zero but marks a declared malformed amount unavailable', () => {
    expect(negativeProjectionCheck([
      { yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: 100 } },
    ], 0)).toMatchObject({ status: 'OK' });

    expect(negativeProjectionCheck([
      { yearMonth: '2026-07', weekNo: 1, projection: { SALES_IN: '100' } },
    ], 0)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      findings: ['Projection 금액 확인 필요'],
    });
    expect(negativeProjectionCheck([], null)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      findings: ['Projection 이월 잔액 확인 필요'],
    });
  });

  it('keeps confirmation and comparison rules anchored to the id list', () => {
    const confirmations = validManagementConfirmations([
      { checkId: 'labor-transfer', decision: 'confirmed' },
      { checkId: 'unknown-check', decision: 'CONFIRMED' },
      { checkId: 'future-prepay-over-million', decision: 'NOT_APPLICABLE' },
    ]);
    expect([...confirmations.keys()]).toEqual(['labor-transfer', 'future-prepay-over-million']);

    const checks = CASHFLOW_MANAGEMENT_CHECK_IDS.map((id) => ({ id, status: 'OK', title: 't', detail: 'd' }));
    expect(matchingManagementChecks(checks, [...checks].reverse())).toBe(true);
    expect(matchingManagementChecks(checks.slice(0, 3), checks.slice(0, 3))).toBe(false);
    expect(matchingManagementChecks(checks, checks.map((c) => ({ ...c, status: 'WARNING' })))).toBe(false);
  });
});
