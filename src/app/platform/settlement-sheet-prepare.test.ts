import { describe, expect, it } from 'vitest';
import { getYearMondayWeeks } from './cashflow-weeks';
import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';
import { buildSettlementActualSyncPayload } from './settlement-sheet-sync';
import {
  isSettlementRowMeaningful,
  prepareSettlementImportRows,
  pruneEmptySettlementRows,
} from './settlement-sheet-prepare';

function makeRow(values: Record<string, string>): ImportRow {
  return {
    tempId: `row-${Math.random().toString(36).slice(2, 8)}`,
    cells: SETTLEMENT_COLUMNS.map((column) => values[column.csvHeader] || ''),
  };
}

function readCell(row: ImportRow, header: string): string {
  const index = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
  expect(index).toBeGreaterThanOrEqual(0);
  return row.cells[index];
}

describe('prepareSettlementImportRows', () => {
  it('derives week/evidence state so imported rows are recognized by cashflow sync', () => {
    const prepared = prepareSettlementImportRows(
      [
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
      ],
      {
        projectId: 'p-001',
        defaultLedgerId: 'l-001',
        evidenceRequiredMap: {
          '회의비|다과비': '영수증, 결과보고서',
        },
      },
    );

    expect(prepared).toHaveLength(1);
    expect(readCell(prepared[0], '해당 주차')).toBeTruthy();
    expect(readCell(prepared[0], '필수증빙자료 리스트')).toBe('영수증, 결과보고서');
    expect(readCell(prepared[0], '준비필요자료')).toBe('결과보고서');
    expect(prepared[0].error).toBeUndefined();

    const payload = buildSettlementActualSyncPayload(prepared, getYearMondayWeeks(2026));
    expect(payload).toHaveLength(1);
    expect(payload[0]?.amounts.DIRECT_COST_OUT).toBe(30000);
  });

  it('drops rows that only contain derived or protected settlement fields', () => {
    const meaningful = makeRow({
      'No.': '1',
      '거래일시': '2026-03-05',
      '지급처': '카페 메리',
    });
    const derivedOnly = makeRow({
      'No.': '2',
      '필수증빙자료 리스트': '영수증',
      '실제 구비 완료된 증빙자료 리스트': '영수증',
      '준비필요자료': '결과보고서',
    });

    expect(isSettlementRowMeaningful(meaningful)).toBe(true);
    expect(isSettlementRowMeaningful(derivedOnly)).toBe(false);
    expect(pruneEmptySettlementRows([meaningful, derivedOnly])).toEqual([meaningful]);
  });
});
