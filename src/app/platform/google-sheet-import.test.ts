import { describe, expect, it } from 'vitest';
import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';
import {
  GOOGLE_SHEET_PROTECTED_HEADERS,
  buildGoogleSheetImportMatchKey,
  planGoogleSheetImportMerge,
} from './google-sheet-import';

function makeRow(values: Record<string, string>, sourceTxId?: string): ImportRow {
  const cells = SETTLEMENT_COLUMNS.map((column) => values[column.csvHeader] || '');
  return {
    tempId: values['No.'] || `row-${Math.random().toString(36).slice(2, 8)}`,
    ...(sourceTxId ? { sourceTxId } : {}),
    cells,
  };
}

describe('google-sheet-import', () => {
  it('builds stable row match keys', () => {
    const row = makeRow({
      '거래일시': '2026-03-12',
      '지급처': '카페 메리',
      '통장에 찍힌 입/출금액': '12,300',
      '비목': '회의비',
      '세목': '다과비',
    });

    expect(buildGoogleSheetImportMatchKey(row)).toBe('2026-03-12|카페메리|12300|회의비|다과비');
  });

  it('merges non-empty sheet cells without overwriting protected fields', () => {
    const existing = [
      makeRow({
        'No.': '1',
        '거래일시': '2026-03-12',
        '지급처': '카페 메리',
        '통장에 찍힌 입/출금액': '12,300',
        '비목': '회의비',
        '세목': '다과비',
        '상세 적요': '기존 메모',
        '증빙자료 드라이브': 'https://drive.google.com/drive/folders/existing',
        '실제 구비 완료된 증빙자료 리스트': '세금계산서',
      }, 'tx-001'),
    ];

    const imported = [
      makeRow({
        '거래일시': '2026-03-12',
        '지급처': '카페 메리',
        '통장에 찍힌 입/출금액': '12,300',
        '비목': '회의비',
        '세목': '다과비',
        '상세 적요': '가져온 메모',
        '증빙자료 드라이브': 'https://drive.google.com/drive/folders/new',
        '실제 구비 완료된 증빙자료 리스트': '입금확인서',
      }),
    ];

    const plan = planGoogleSheetImportMerge(existing, imported);
    const mergedRow = plan.mergedRows[0];

    expect(mergedRow.cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '상세 적요')]).toBe('가져온 메모');
    expect(mergedRow.cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '증빙자료 드라이브')]).toBe('https://drive.google.com/drive/folders/existing');
    expect(mergedRow.cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '실제 구비 완료된 증빙자료 리스트')]).toBe('세금계산서');
    expect(plan.summary.updateCount).toBe(1);
    expect(plan.summary.protectedHeaders).toEqual(GOOGLE_SHEET_PROTECTED_HEADERS);
  });

  it('appends new rows and preserves existing values when imported cells are blank', () => {
    const existing = [
      makeRow({
        'No.': '1',
        '거래일시': '2026-03-11',
        '지급처': '기존 거래처',
        '통장에 찍힌 입/출금액': '8,000',
        '비목': '운영비',
        '세목': '소모품비',
        '상세 적요': '기존 적요',
      }),
    ];
    const imported = [
      makeRow({
        '거래일시': '2026-03-11',
        '지급처': '기존 거래처',
        '통장에 찍힌 입/출금액': '8,000',
        '비목': '운영비',
        '세목': '소모품비',
        '상세 적요': '',
      }),
      makeRow({
        '거래일시': '2026-03-12',
        '지급처': '새 거래처',
        '통장에 찍힌 입/출금액': '15,000',
        '비목': '회의비',
        '세목': '장소대관비',
        '상세 적요': '새 행',
        '증빙자료 드라이브': 'https://drive.google.com/drive/folders/ignored',
      }),
    ];

    const plan = planGoogleSheetImportMerge(existing, imported);

    expect(plan.mergedRows).toHaveLength(2);
    expect(plan.mergedRows[0].cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '상세 적요')]).toBe('기존 적요');
    expect(plan.mergedRows[1].cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '증빙자료 드라이브')]).toBe('');
    expect(plan.summary.createCount).toBe(1);
    expect(plan.summary.unchangedCount).toBe(1);
    expect(plan.mergedRows.map((row) => row.cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'No.')])).toEqual(['1', '2']);
  });
});
