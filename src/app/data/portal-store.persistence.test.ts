import { describe, expect, it } from 'vitest';
import {
  patchExpenseSheetProjectionEvidenceBySourceTxId,
  upsertExpenseSheetProjectionRowBySourceTxId,
  upsertExpenseSheetTabRows,
} from './portal-store.persistence';
import type { BankImportIntakeItem } from './types';

function makeIntakeItem(overrides: Partial<BankImportIntakeItem> = {}): BankImportIntakeItem {
  return {
    id: 'intake-1',
    projectId: 'p-1',
    sourceTxId: 'bank:fp-1',
    bankFingerprint: 'fp-1',
    bankSnapshot: {
      accountNumber: '111-222-333',
      dateTime: '2026-04-07',
      counterparty: '코레일',
      memo: 'KTX 예매',
      signedAmount: -15000,
      balanceAfter: 500000,
    },
    matchState: 'AUTO_CONFIRMED',
    projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
    evidenceStatus: 'MISSING',
    manualFields: {
      expenseAmount: 15000,
      budgetCategory: '여비',
      budgetSubCategory: '교통비',
      cashflowCategory: 'TRAVEL',
      memo: '서울 이동',
    },
    reviewReasons: [],
    lastUploadBatchId: 'batch-1',
    createdAt: '2026-04-06T00:00:00.000Z',
    updatedAt: '2026-04-06T00:00:00.000Z',
    updatedBy: 'pm',
    ...overrides,
  };
}

describe('upsertExpenseSheetTabRows', () => {
  it('replaces the active sheet rows immediately after save so selection reconcile does not fall back to stale rows', () => {
    const next = upsertExpenseSheetTabRows({
      sheets: [
        {
          id: 'default',
          name: '기본 탭',
          order: 0,
          rows: [
            { tempId: 'row-1', cells: ['첫번째만 남은 stale row'] },
          ],
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
        },
      ],
      sheetId: 'default',
      sheetName: '기본 탭',
      order: 0,
      rows: [
        { tempId: 'row-1', cells: ['첫번째 row'] },
        { tempId: 'row-2', cells: ['두번째 row'] },
        { tempId: 'row-3', cells: ['세번째 row'] },
      ],
      now: '2026-04-06T01:00:00.000Z',
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.rows).toHaveLength(3);
    expect(next[0]?.rows.map((row) => row.tempId)).toEqual(['row-1', 'row-2', 'row-3']);
    expect(next[0]?.updatedAt).toBe('2026-04-06T01:00:00.000Z');
  });

  it('inserts a missing active sheet when saving a newly created tab', () => {
    const next = upsertExpenseSheetTabRows({
      sheets: [
        {
          id: 'default',
          name: '기본 탭',
          order: 0,
          rows: [],
          createdAt: '2026-04-06T00:00:00.000Z',
          updatedAt: '2026-04-06T00:00:00.000Z',
        },
      ],
      sheetId: 'sheet-2',
      sheetName: '탭 2',
      order: 1,
      rows: [
        { tempId: 'row-9', cells: ['신규 탭 row'] },
      ],
      now: '2026-04-06T01:00:00.000Z',
    });

    expect(next).toHaveLength(2);
    expect(next[1]?.id).toBe('sheet-2');
    expect(next[1]?.rows).toHaveLength(1);
  });
});

describe('upsertExpenseSheetProjectionRowBySourceTxId', () => {
  it('updates only the matched bank-origin row and keeps unrelated rows intact', () => {
    const result = upsertExpenseSheetProjectionRowBySourceTxId({
      rows: [
        {
          tempId: 'manual-1',
          cells: ['수기 행'],
        },
        {
          tempId: 'row-bank',
          sourceTxId: 'bank:fp-1',
          cells: Array.from({ length: 27 }, () => ''),
        },
      ],
      item: makeIntakeItem(),
      evidenceRequiredDesc: '출장신청서, 영수증',
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.tempId).toBe('manual-1');
    expect(result.projectedRow.sourceTxId).toBe('bank:fp-1');
    expect(result.projectedRow.cells[5]).toBe('여비');
    expect(result.projectedRow.cells[6]).toBe('교통비');
    expect(result.projectedRow.cells[8]).toBe('직접사업비');
    expect(result.projectedRow.cells[10]).toBe('15,000');
    expect(result.projectedRow.cells[15]).toBe('코레일');
    expect(result.projectedRow.cells[17]).toBe('출장신청서, 영수증');
    expect(result.projectedRow.cells[19]).toBe('출장신청서, 영수증');
  });

  it('prefers explicit cashflow line ids over legacy category fallbacks when projecting rows', () => {
    const result = upsertExpenseSheetProjectionRowBySourceTxId({
      rows: [
        {
          tempId: 'row-bank',
          sourceTxId: 'bank:fp-1',
          cells: Array.from({ length: 27 }, () => ''),
        },
      ],
      item: makeIntakeItem({
        manualFields: {
          expenseAmount: 15000,
          budgetCategory: '인건비',
          budgetSubCategory: '강사비',
          cashflowCategory: 'TRAVEL',
          cashflowLineId: 'MYSC_LABOR_OUT',
        },
      }),
      evidenceRequiredDesc: '계약서',
    });

    expect(result.projectedRow.cells[8]).toBe('MYSC 인건비');
  });

  it('inserts a new bank-origin row when the source transaction is not projected yet', () => {
    const result = upsertExpenseSheetProjectionRowBySourceTxId({
      rows: [
        {
          tempId: 'manual-1',
          cells: ['수기 행'],
        },
      ],
      item: makeIntakeItem(),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]?.sourceTxId).toBe('bank:fp-1');
    expect(result.projectedRow.tempId).toContain('bank-fp-1');
  });

  it('patches evidence fields without overwriting manual classification fields', () => {
    const cells = Array.from({ length: 27 }, () => '');
    cells[5] = '여비';
    cells[6] = '교통비';
    cells[10] = '15,000';

    const result = patchExpenseSheetProjectionEvidenceBySourceTxId({
      rows: [
        {
          tempId: 'row-1',
          sourceTxId: 'bank:fp-1',
          cells,
        },
      ],
      sourceTxId: 'bank:fp-1',
      evidenceRequiredDesc: '출장신청서, 영수증',
      evidenceCompletedDesc: '출장신청서',
      evidenceStatus: 'PARTIAL',
    });

    expect(result.rows[0]?.cells[17]).toBe('출장신청서, 영수증');
    expect(result.rows[0]?.cells[18]).toBe('출장신청서');
    expect(result.rows[0]?.cells[19]).toBe('영수증');
    expect(result.rows[0]?.cells[5]).toBe('여비');
    expect(result.rows[0]?.cells[6]).toBe('교통비');
    expect(result.rows[0]?.cells[10]).toBe('15,000');
  });
});
