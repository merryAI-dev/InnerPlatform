import { describe, expect, it } from 'vitest';
import type { Transaction } from '../data/types';
import { getYearMondayWeeks } from './cashflow-weeks';
import {
  SETTLEMENT_COLUMNS,
  exportSettlementCsv,
  importRowToTransaction,
  renumberImportRows,
  transactionsToImportRows,
  type ImportRow,
} from './settlement-csv';

function makeBaseRow(cells: Record<string, string>): ImportRow {
  return {
    tempId: 'row-1',
    cells: SETTLEMENT_COLUMNS.map((column) => cells[column.csvHeader] || ''),
  };
}

describe('settlement-csv', () => {
  it('exports enhanced labels and derived supply amount', () => {
    const tx: Transaction = {
      id: 'tx-1',
      ledgerId: 'l-1',
      projectId: 'p-1',
      state: 'DRAFT',
      dateTime: '2026-03-05',
      weekCode: '',
      direction: 'OUT',
      method: 'CORP_CARD_1',
      cashflowCategory: 'OUTSOURCING',
      cashflowLabel: '직접사업비(공급가액)',
      budgetCategory: '2.1',
      budgetSubCategory: '2.1.1',
      budgetSubSubCategory: '',
      counterparty: '외주파트너',
      memo: '내부 메모',
      internalMemo: '내부 메모',
      bankMemo: '은행 원문 적요',
      amounts: {
        bankAmount: 1100,
        depositAmount: 0,
        expenseAmount: 1100,
        supplyAmount: 1000,
        vatIn: 100,
        vatOut: 0,
        vatRefund: 0,
        balanceAfter: 5000,
      },
      evidenceRequired: [],
      evidenceStatus: 'MISSING',
      evidenceMissing: [],
      attachmentsCount: 0,
      createdBy: 'u001',
      createdAt: '2026-03-05T00:00:00Z',
      updatedBy: 'u001',
      updatedAt: '2026-03-05T00:00:00Z',
      settlementProgress: 'INCOMPLETE',
    };

    const csv = exportSettlementCsv([tx], getYearMondayWeeks(2026));

    expect(csv).toContain('법인카드(뒷번호1)');
    expect(csv).toContain('매입부가세');
    expect(csv).toContain('1,100');
  });

  it('maps enhanced import rows to derived settlement fields', () => {
    const row = makeBaseRow({
      작성자: 'PM',
      거래일시: '2026-03-05',
      지출구분: '개인법인카드',
      비목: '2.1',
      세목: '2.1.1',
      cashflow항목: '직접사업비(공급가액)',
      '통장에 찍힌 입/출금액': '11,000',
      '사업비 사용액': '11,000',
      매입부가세: '1,000',
      지급처: '파트너사',
      '상세 적요': '행사 운영비',
      비고: '검토 완료',
    });
    row.settlementProgress = 'COMPLETE';

    const result = importRowToTransaction(row, 'p-1', 'l-1', 0);

    expect(result.error).toBeUndefined();
    expect(result.transaction?.method).toBe('CORP_CARD_2');
    expect(result.transaction?.memo).toBe('행사 운영비');
    expect(result.transaction?.amounts.supplyAmount).toBe(10000);
    expect(result.transaction?.settlementProgress).toBe('COMPLETE');
  });

  it('builds import rows with derived enhanced columns', () => {
    const tx: Transaction = {
      id: 'tx-2',
      ledgerId: 'l-1',
      projectId: 'p-1',
      state: 'DRAFT',
      dateTime: '2026-03-06',
      weekCode: '',
      direction: 'OUT',
      method: 'CORP_CARD_2',
      cashflowCategory: 'TRAVEL',
      cashflowLabel: '직접사업비(공급가액)',
      budgetCategory: '2.1',
      counterparty: '출장비',
      memo: '출장 내부 메모',
      internalMemo: '출장 내부 메모',
      amounts: {
        bankAmount: 2200,
        depositAmount: 0,
        expenseAmount: 2200,
        vatIn: 200,
        vatOut: 0,
        vatRefund: 0,
        balanceAfter: 10000,
      },
      evidenceRequired: [],
      evidenceStatus: 'MISSING',
      evidenceMissing: [],
      attachmentsCount: 0,
      createdBy: 'u001',
      createdAt: '2026-03-06T00:00:00Z',
      updatedBy: 'u001',
      updatedAt: '2026-03-06T00:00:00Z',
      settlementProgress: 'INCOMPLETE',
    };

    const rows = transactionsToImportRows([tx], getYearMondayWeeks(2026));
    const memoIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '상세 적요');
    const methodIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '지출구분');

    expect(rows[0].cells[memoIdx]).toBe('출장 내부 메모');
    expect(rows[0].cells[methodIdx]).toBe('법인카드(뒷번호2)');
    expect(rows[0].settlementProgress).toBe('INCOMPLETE');
  });

  it('renumbers rows after structural edits while keeping hidden progress state', () => {
    const rows = renumberImportRows([
      { ...makeBaseRow({ 작성자: 'A', 'No.': '7' }), tempId: 'row-1', settlementProgress: 'COMPLETE' },
      { ...makeBaseRow({ 작성자: 'B', 'No.': '99' }), tempId: 'row-2' },
    ]);
    const noIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'No.');

    expect(rows[0].cells[noIdx]).toBe('1');
    expect(rows[1].cells[noIdx]).toBe('2');
    expect(rows[0].settlementProgress).toBe('COMPLETE');
    expect(rows[1].settlementProgress).toBe('INCOMPLETE');
  });
});
