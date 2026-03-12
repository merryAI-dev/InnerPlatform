import { describe, expect, it } from 'vitest';
import {
  detectBankStatementProfile,
  getBankStatementProfileLabel,
  mapBankStatementsToImportRows,
  normalizeBankStatementMatrix,
} from './bank-statement';

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
});
