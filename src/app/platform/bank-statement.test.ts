import { describe, expect, it } from 'vitest';
import {
  buildBankImportIntakeItemsFromBankSheet,
  detectBankStatementProfile,
  getBankStatementProfileLabel,
  mergeBankRowsIntoExpenseSheet,
  mapBankStatementsToImportRows,
  normalizeBankStatementMatrix,
} from './bank-statement';
import { SETTLEMENT_COLUMNS, createEmptyImportRow } from './settlement-csv';

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

  it('derives intake items that preserve existing manual weekly classification', () => {
    const sheet = {
      columns: ['통장번호', '거래일시', '적요', '의뢰인/수취인', '출금금액', '잔액'],
      rows: [
        {
          tempId: 'bank-1',
          cells: ['111-222-333', '2026-04-06 10:00', 'KTX 예매', '코레일', '15,000', '500,000'],
        },
      ],
    };

    const initialItems = buildBankImportIntakeItemsFromBankSheet({
      projectId: 'p-1',
      sheet,
      lastUploadBatchId: 'batch-1',
      now: '2026-04-06T00:00:00.000Z',
      updatedBy: 'PM 보람',
    });
    const expenseAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '사업비 사용액');
    const budgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비목');
    const subBudgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '세목');
    const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'cashflow항목');
    const existingRow = createEmptyImportRow();
    existingRow.tempId = 'row-legacy';
    existingRow.sourceTxId = initialItems[0].sourceTxId;
    existingRow.cells[budgetIdx] = '여비';
    existingRow.cells[subBudgetIdx] = '교통비';
    existingRow.cells[cashflowIdx] = '직접사업비';
    existingRow.cells[expenseAmountIdx] = '15,000';

    const nextItems = buildBankImportIntakeItemsFromBankSheet({
      projectId: 'p-1',
      sheet,
      existingRows: [existingRow],
      existingExpenseSheetId: 'default',
      lastUploadBatchId: 'batch-2',
      now: '2026-04-06T01:00:00.000Z',
      updatedBy: 'PM 보람',
    });

    expect(nextItems).toHaveLength(1);
    expect(nextItems[0]).toMatchObject({
      sourceTxId: initialItems[0].sourceTxId,
      matchState: 'AUTO_CONFIRMED',
      projectionStatus: 'PROJECTED_WITH_PENDING_EVIDENCE',
      existingExpenseSheetId: 'default',
      existingExpenseRowTempId: 'row-legacy',
      manualFields: {
        expenseAmount: 15000,
        budgetCategory: '여비',
        budgetSubCategory: '교통비',
        cashflowCategory: 'OUTSOURCING',
      },
    });
  });

  it('does not fall back to row index when bank uploads arrive in a different order', () => {
    const budgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비목');
    const dateIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시');
    const counterpartyIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '지급처');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액');

    const legacyManualRow = createEmptyImportRow();
    legacyManualRow.tempId = 'manual-1';
    legacyManualRow.cells[budgetIdx] = '여비';
    legacyManualRow.cells[dateIdx] = '2026-04-01';
    legacyManualRow.cells[counterpartyIdx] = '기존 수기행';
    legacyManualRow.cells[bankAmountIdx] = '11,000';

    const knownMappedRow = createEmptyImportRow();
    knownMappedRow.tempId = 'bank-known';
    knownMappedRow.sourceTxId = 'bank:known';
    knownMappedRow.cells[budgetIdx] = '교통비';
    knownMappedRow.cells[dateIdx] = '2026-04-02';
    knownMappedRow.cells[counterpartyIdx] = '코레일';
    knownMappedRow.cells[bankAmountIdx] = '22,000';

    const reorderedUploadRows = [
      {
        ...createEmptyImportRow(),
        tempId: 'bank-known-fresh',
        sourceTxId: 'bank:known',
        cells: (() => {
          const cells = createEmptyImportRow().cells;
          cells[dateIdx] = '2026-04-02';
          cells[counterpartyIdx] = '코레일';
          cells[bankAmountIdx] = '22,000';
          return cells;
        })(),
      },
      {
        ...createEmptyImportRow(),
        tempId: 'bank-new',
        sourceTxId: 'bank:new',
        cells: (() => {
          const cells = createEmptyImportRow().cells;
          cells[dateIdx] = '2026-04-03';
          cells[counterpartyIdx] = '새 거래처';
          cells[bankAmountIdx] = '33,000';
          return cells;
        })(),
      },
    ];

    const merged = mergeBankRowsIntoExpenseSheet([legacyManualRow, knownMappedRow], reorderedUploadRows);

    expect(merged[0].sourceTxId).toBe('bank:known');
    expect(merged[0].cells[budgetIdx]).toBe('교통비');
    expect(merged[1].sourceTxId).toBe('bank:new');
    expect(merged[1].cells[budgetIdx]).toBe('');
  });

  it('projects uploaded bank rows straight into weekly expense rows for direct handoff', () => {
    const dateIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시');
    const counterpartyIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '지급처');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액');
    const budgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비목');

    const legacyManualRow = createEmptyImportRow();
    legacyManualRow.tempId = 'manual-1';
    legacyManualRow.cells[budgetIdx] = '출장비';
    legacyManualRow.cells[dateIdx] = '2026-04-01';
    legacyManualRow.cells[counterpartyIdx] = '수기 입력 건';
    legacyManualRow.cells[bankAmountIdx] = '11,000';

    const merged = mergeBankRowsIntoExpenseSheet(
      [legacyManualRow],
      mapBankStatementsToImportRows({
        columns: ['거래일시', '적요', '의뢰인/수취인', '출금금액', '잔액'],
        rows: [
          {
            tempId: 'bank-1',
            cells: ['2026-04-08 09:00', 'KTX 예매', '코레일', '15,000', '500,000'],
          },
        ],
      }),
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].sourceTxId).toMatch(/^bank:/);
    expect(merged[0].cells[dateIdx]).toBe('2026-04-08');
    expect(merged[0].cells[counterpartyIdx]).toBe('코레일');
    expect(merged[0].cells[bankAmountIdx]).toBe('15,000');
  });
});
