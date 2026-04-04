import { describe, expect, it } from 'vitest';
import {
  detectBankStatementProfile,
  getBankStatementProfileLabel,
  mapBankStatementsToImportRows,
  normalizeBankStatementMatrix,
} from './bank-statement';
import { SETTLEMENT_COLUMNS } from './settlement-csv';

describe('bank statement helpers', () => {
  it('detects known bank profiles from headers and file name', () => {
    expect(detectBankStatementProfile(['거래일시', '적요', '신한은행 메모'], 'statement.xlsx')).toBe('shinhan');
    expect(detectBankStatementProfile(['거래일자', '국민 계좌', '출금금액'], 'bank.csv')).toBe('kb');
    expect(detectBankStatementProfile(['거래일시', '적요', '입금금액'], '하나은행 거래내역.xlsx')).toBe('hana');
    expect(getBankStatementProfileLabel('generic')).toBe('일반 형식');
  });

  it('finds the real header row even when the first line is blank', () => {
    const matrix = [
      ['', '', ''],
      ['거래일시', '적요', '출금금액'],
      ['2026-03-10', '법인카드 결제', '12,000'],
    ];
    const normalized = normalizeBankStatementMatrix(matrix);
    expect(normalized.columns).toEqual(['거래일시', '적요', '출금금액']);
    expect(normalized.rows).toHaveLength(1);
    expect(normalized.rows[0].cells[1]).toBe('법인카드 결제');
  });

  it('maps bank memo data into weekly expense import rows', () => {
    const rows = mapBankStatementsToImportRows({
      columns: ['거래일시', '적요', '의뢰인/수취인', '출금금액', '잔액'],
      rows: [
        {
          tempId: 'bank-1',
          cells: ['2026-03-10', 'Masion Viet (프랑스)', 'Masion Viet', '90,000', '500,000'],
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].cells.some((cell) => cell === 'Masion Viet (프랑스)')).toBe(true);
    expect(rows[0].cells.some((cell) => cell === 'Masion Viet')).toBe(true);
  });

  it('maps US-style bank export dates without dropping rows', () => {
    const dateIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액');
    const depositIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '입금액(사업비,공급가액,은행이자)');
    const rows = mapBankStatementsToImportRows({
      columns: ['거래일시', '적요', '출금금액', '입금금액', '잔액'],
      rows: [
        {
          tempId: 'bank-1',
          cells: ['12/31/25', '23CTS선입금', '', '10,000,000', '10,644,328'],
        },
        {
          tempId: 'bank-2',
          cells: ['1/4/26', 'W-store스타약국', '31,000', '', '1,435,848'],
        },
        {
          tempId: 'bank-3',
          cells: ['03/19/2026', '테스트 거래', '12,000', '', '1,423,848'],
        },
      ],
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.cells[dateIdx])).toEqual([
      '2025-12-31',
      '2026-01-04',
      '2026-03-19',
    ]);
    expect(rows[0]?.entryKind).toBe('DEPOSIT');
    expect(rows[0]?.cells[bankAmountIdx]).toBe('10,000,000');
    expect(rows[0]?.cells[depositIdx]).toBe('10,000,000');
    expect(rows[1]?.entryKind).toBe('EXPENSE');
    expect(rows[1]?.cells[bankAmountIdx]).toBe('31,000');
    expect(rows[1]?.cells[depositIdx]).toBe('');
  });
});
