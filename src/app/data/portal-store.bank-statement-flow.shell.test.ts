import { describe, expect, it } from 'vitest';
import {
  buildBankImportIntakeItemsFromServerLines,
  buildWeeklyExpenseApplyCells,
  buildWeeklyExpenseBankImportPayloadFromIntakeItems,
} from './portal-store';
import type { BankImportIntakeItem } from './types';
import { createEmptyImportRow, SETTLEMENT_COLUMNS } from '../platform/settlement-csv';

function makeIntakeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'fingerprint-1',
    projectId: 'project-bank',
    sourceTxId: 'bank:fingerprint-1',
    bankFingerprint: 'fingerprint-1',
    serverImportLineId: 'line-1',
    bankSnapshot: {
      accountNumber: '',
      dateTime: '2026-06-01',
      counterparty: '거래처1',
      memo: '업로드 후보',
      signedAmount: -1000,
      balanceAfter: 9000,
    },
    matchState: 'PENDING_INPUT',
    projectionStatus: 'NOT_PROJECTED',
    evidenceStatus: 'MISSING',
    manualFields: {},
    reviewReasons: [],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    updatedBy: 'PM',
    ...overrides,
  };
}

describe('portal-store bank statement staging flow', () => {
  it('builds Java import-batch payload without auto-applying rows and preserves ragged raw cells', () => {
    const payload = buildWeeklyExpenseBankImportPayloadFromIntakeItems({
      uploadName: 'bank-upload-1',
      columns: ['거래일자', '적요', '출금액', '잔액'],
      rows: [
        { tempId: 'short', cells: ['2026-06-01', '짧은 행'] },
        { tempId: 'long', cells: ['2026-06-02', '긴 행', '2,000', '7,000', '추가 컬럼'] },
      ],
      intakeItems: [
        makeIntakeItem(),
        makeIntakeItem({
          id: 'fingerprint-2',
          sourceTxId: 'bank:fingerprint-2',
          bankFingerprint: 'fingerprint-2',
          serverImportLineId: undefined,
          bankSnapshot: {
            accountNumber: '',
            dateTime: '2026-06-02',
            counterparty: '거래처2',
            memo: '긴 행 후보',
            signedAmount: -2000,
            balanceAfter: 7000,
          },
        }),
      ],
    });

    expect(payload).toEqual({
      uploadName: 'bank-upload-1',
      columns: ['거래일자', '적요', '출금액', '잔액'],
      lines: [
        {
          lineIndex: 0,
          sourceLineKey: 'bank:fingerprint-1',
          transactionDate: '2026-06-01',
          counterparty: '거래처1',
          memo: '업로드 후보',
          signedAmount: -1000,
          balanceAfter: 9000,
          rawCells: ['2026-06-01', '짧은 행'],
        },
        {
          lineIndex: 1,
          sourceLineKey: 'bank:fingerprint-2',
          transactionDate: '2026-06-02',
          counterparty: '거래처2',
          memo: '긴 행 후보',
          signedAmount: -2000,
          balanceAfter: 7000,
          rawCells: ['2026-06-02', '긴 행', '2,000', '7,000', '추가 컬럼'],
        },
      ],
    });
  });

  it('rebuilds staged intake candidates from Java ORM import lines', () => {
    const items = buildBankImportIntakeItemsFromServerLines({
      projectId: 'project-bank',
      now: '2026-06-08T01:00:00.000Z',
      lines: [
        {
          id: 'line-1',
          batchId: 'batch-1',
          uploadName: 'bank.xlsx',
          batchStatus: 'staged',
          batchCreatedBy: 'pm-1',
          batchCreatedAt: '2026-06-08T00:00:00.000Z',
          lineIndex: 0,
          sourceLineKey: 'bank:fingerprint-1',
          transactionDate: '2026-06-01',
          counterparty: '거래처1',
          memo: '선택 대기',
          signedAmount: '-1000',
          balanceAfter: '9000',
          rawCells: ['2026-06-01', '-1000'],
          status: 'staged',
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'fingerprint-1',
      sourceTxId: 'bank:fingerprint-1',
      bankFingerprint: 'fingerprint-1',
      serverImportLineId: 'line-1',
      matchState: 'PENDING_INPUT',
      projectionStatus: 'NOT_PROJECTED',
      evidenceStatus: 'MISSING',
      lastUploadBatchId: 'batch-1',
      updatedBy: 'pm-1',
      bankSnapshot: {
        dateTime: '2026-06-01',
        counterparty: '거래처1',
        memo: '선택 대기',
        signedAmount: -1000,
        balanceAfter: 9000,
      },
    });
  });

  it('builds selected apply cells from the row only and keeps a fixed authority column width', () => {
    const row = createEmptyImportRow();
    const weekIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '해당 주차');
    const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'cashflow항목');
    row.cells[weekIdx] = '2026-06-W1';
    row.cells[cashflowIdx] = '사업비';
    row.userEditedCells = new Set([weekIdx, cashflowIdx]);

    const cells = buildWeeklyExpenseApplyCells(row);

    expect(cells).toHaveLength(20);
    expect(cells[weekIdx]).toEqual({ columnIndex: weekIdx, rawValue: '2026-06-W1', userEdited: true });
    expect(cells[cashflowIdx]).toEqual({ columnIndex: cashflowIdx, rawValue: '사업비', userEdited: true });
    expect(cells.every((cell, index) => cell.columnIndex === index)).toBe(true);
  });
});
