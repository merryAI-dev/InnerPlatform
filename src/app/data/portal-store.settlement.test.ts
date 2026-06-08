import { describe, expect, it } from 'vitest';
import { createSettlementSheetPolicy, type Basis, type SettlementSheetPolicy } from './types';
import { SETTLEMENT_COLUMNS, type ImportRow } from '../platform/settlement-csv';
import { prepareSettlementImportRowsBase } from '../platform/settlement-sheet-prepare';
import { prepareExpenseSheetRowsForSave } from './portal-store.settlement';

function makeRow(values: Record<string, string>, partial?: Partial<ImportRow>): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2, 8)}`,
    cells: SETTLEMENT_COLUMNS.map((column) => values[column.csvHeader] || ''),
    ...partial,
  };
}

function readCell(row: ImportRow, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return row.cells[index];
}

function buildParams(partial?: {
  policy?: SettlementSheetPolicy;
  basis?: Basis;
}) {
  return {
    projectId: 'p-001',
    defaultLedgerId: 'l-001',
    evidenceRequiredMap: {
      '회의비|다과비': '영수증, 결과보고서',
    },
    policy: partial?.policy,
    basis: partial?.basis,
  };
}

describe('prepareExpenseSheetRowsForSave', () => {
  it('requires counterparty by default for every settlement sheet preset', () => {
    expect(createSettlementSheetPolicy('STANDARD').requireCounterparty).toBe(true);
    expect(createSettlementSheetPolicy('DIRECT_ENTRY').requireCounterparty).toBe(true);
    expect(createSettlementSheetPolicy('BALANCE_TRACKING').requireCounterparty).toBe(true);
  });

  it('drops empty rows and returns normalized base rows without frontend derivation', () => {
    const rows = [
      makeRow({
        '작성자': '메리',
        '거래일시': '2026-03-05',
        '지출구분': '계좌이체',
        '비목': '회의비',
        '세목': '다과비',
        'cashflow항목': '직접사업비',
        '통장에 찍힌 입/출금액': '33,000',
        '사업비 사용액': '30,000',
        '매입부가세': '3,000',
        '실제 구비 완료된 증빙자료 리스트': '영수증',
        '지급처': '카페 메리',
      }),
      makeRow({
        'No.': '2',
        '해당 주차': '26-03-02',
        '필수증빙자료 리스트': '영수증',
      }),
    ];

    const expected = prepareSettlementImportRowsBase(rows, buildParams());
    const prepared = prepareExpenseSheetRowsForSave({
      rows,
      ...buildParams(),
    });

    expect(prepared).toEqual(expected);
    expect(prepared).toHaveLength(1);
    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('영수증, 결과보고서');
    expect(readCell(prepared[0], '해당 주차')).toBe('');
  });

  it('works without tenant or actor runtime inputs', () => {
    const prepared = prepareExpenseSheetRowsForSave({
      rows: [
        makeRow({
          '거래일시': '2026-03-05',
          '지출구분': '계좌이체',
          '비목': '여비',
          '세목': '교통비',
          'cashflow항목': '직접사업비',
          '통장에 찍힌 입/출금액': '15,000',
        }, {
          sourceTxId: 'bank:expense-1',
          entryKind: 'EXPENSE',
        }),
      ],
      projectId: 'p-001',
      defaultLedgerId: 'l-001',
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0].sourceTxId).toBe('bank:expense-1');
    expect(readCell(prepared[0], '거래일시')).toBe('2026-03-05');
  });
});
