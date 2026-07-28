import { describe, expect, it } from 'vitest';
import { describeCashflowFormulaMismatch } from './CashflowFormulaMismatchDialog';

describe('CashflowFormulaMismatchDialog', () => {
  it('explains a missing weekly total with the official sheet calculation', () => {
    const result = describeCashflowFormulaMismatch({
      yearMonth: '2026-12',
      weekNo: 5,
      mode: 'projection',
      field: 'depositTotal',
      reported: null,
      calculated: 0,
      sourceCell: 'BL22',
    });

    expect(result.expected).toContain('BL15~21 행의 입금 항목을 모두 더한 값');
    expect(result.expected).toContain('0원이 표시되어야');
    expect(result.current).toBe('현재 시트에는 이 값이 비어 있습니다.');
  });

  it('explains the first annual balance without inventing a prior-year balance', () => {
    const result = describeCashflowFormulaMismatch({
      year: 2024,
      mode: 'actual',
      field: 'balance',
      reported: null,
      calculated: 0,
      sourceCell: 'C56',
    });

    expect(result.expected).toContain('C45 입금 합계 − C55 출금 합계');
    expect(result.expected).not.toContain('직전 기간 잔액');
  });

  it('explains a later annual balance as a carried-forward balance', () => {
    const result = describeCashflowFormulaMismatch({
      year: 2027,
      mode: 'projection',
      field: 'balance',
      reported: 10,
      calculated: 0,
      sourceCell: 'BM33',
    });

    expect(result.expected).toContain('직전 기간 잔액 + BM22 입금 합계 − BM32 출금 합계');
    expect(result.current).toContain('10원이 표시되어 있습니다.');
  });
});
