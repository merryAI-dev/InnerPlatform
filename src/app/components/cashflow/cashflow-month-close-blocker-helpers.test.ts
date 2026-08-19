import { describe, expect, it } from 'vitest';
import { describeCashflowMonthCloseIssue } from './cashflow-month-close-blocker-helpers';

describe('describeCashflowMonthCloseIssue', () => {
  it('names the cell and the value that is not a number', () => {
    expect(describeCashflowMonthCloseIssue({
      code: 'SHEET_VALUE_INVALID',
      message: '시트의 날짜 또는 금액 형식을 확인해 주세요.',
      details: [
        { code: 'sheet_value_invalid', field: 'line:SALES_IN', sourceCell: 'AK17', rawValue: '3월 말' },
        { code: 'control_total_missing', field: 'depositControl', sourceCell: 'BO9' },
      ],
    })).toEqual([
      'AK17 칸 · 매출액(입금)이(가) 숫자가 아니에요 (지금 값: 3월 말).',
      'BO9 칸 · 입금 예정 합계이(가) 비어 있어요. 값을 채워 주세요.',
    ]);
  });

  it('names the week and which total could not be read', () => {
    expect(describeCashflowMonthCloseIssue({
      code: 'SHEET_CALCULATION_VALUE_INVALID',
      message: '월 결산 대상의 입금·출금 합계 또는 잔액 값을 확인해 주세요.',
      details: [{
        mode: 'actual',
        weekNo: 3,
        matches: { depositTotal: true, withdrawalTotal: null, balance: null },
        sourceCells: { depositTotal: 'AB56', withdrawalTotal: 'AB57', balance: 'AB58' },
      }],
    })).toEqual(['Actual 3주차 · 출금 합계(AB57), 잔액(AB58) 값을 읽지 못했어요. 숫자인지 확인해 주세요.']);
  });

  it('separates a mismatch from an unreadable value', () => {
    expect(describeCashflowMonthCloseIssue({
      code: 'SHEET_CALCULATION_MISMATCH',
      message: '월 결산 대상의 시트 합계 또는 잔액이 항목 합계와 다릅니다.',
      details: [{
        mode: 'projection',
        weekNo: 5,
        matches: { depositTotal: true, withdrawalTotal: true, balance: false },
        sourceCells: { balance: 'X33' },
      }],
    })).toEqual(['Projection 5주차 · 잔액(X33)이(가) 항목을 더한 값과 달라요.']);
  });

  it('lists every mismatching control total row by its business label', () => {
    expect(describeCashflowMonthCloseIssue({
      code: 'SHEET_CONTROL_TOTAL_MISMATCH',
      message: '전체 주차 합계와 시트 BO control total이 다릅니다.',
      details: {
        deposit: { matches: false, sourceCell: 'BO9' },
        rows: [{ kind: 'line', lineId: 'DIRECT_COST_OUT', sourceCell: 'BO25', matches: false }],
      },
    })).toEqual([
      '입금 예정 합계(BO9)이(가) 주차 합계와 달라요.',
      '직접사업비(BO25) · 시트 합계와 주차 합계가 달라요.',
    ]);
  });

  it('passes management findings through, falling back to the detail sentence', () => {
    expect(describeCashflowMonthCloseIssue({
      code: 'MANAGEMENT_CHECK_NEGATIVE_PROJECTION_BALANCE',
      message: 'Projection 잔액 음수',
      details: { status: 'WARNING', detail: '3주차 잔액이 음수입니다.', findings: ['26-8-3 잔액 -1,200,000원'] },
    })).toEqual(['26-8-3 잔액 -1,200,000원']);
    expect(describeCashflowMonthCloseIssue({
      code: 'MANAGEMENT_CHECK_LABOR_TRANSFER',
      message: '인건비 이체',
      details: { status: 'REVIEW_REQUIRED', detail: '확인이 필요합니다.', findings: [] },
    })).toEqual(['확인이 필요합니다.']);
  });

  it('stays silent when the server sent no usable detail', () => {
    expect(describeCashflowMonthCloseIssue(null)).toEqual([]);
    expect(describeCashflowMonthCloseIssue({ code: 'SHEET_FACTS_MISSING', message: '시트 검증값이 없습니다.' })).toEqual([]);
    expect(describeCashflowMonthCloseIssue({ code: 'SHEET_VALUE_INVALID', message: 'x', details: 'not-an-array' })).toEqual([]);
  });
});
