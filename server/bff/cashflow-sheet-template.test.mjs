import { describe, expect, it } from 'vitest';
import {
  analyzeCashflowSheetTemplate,
  buildCashflowLineLookup,
  parseCashflowWeekLabel,
  toA1,
} from './cashflow-sheet-template.mjs';

const PROJECTION_LABELS = [
  'MYSC 선입금 - 직접사업비 등',
  'MYSC 선입금 - MYSC 인건비',
  'MYSC 선입금 - 메입부가세',
  '매출액(입금)',
  '매출부가세(입금)',
  '팀지원금(입금)',
  '은행이자(입금)',
  'MYSC 선입금 - 직접사업비 등',
  'MYSC 선입금 - MYSC 인건비',
  '직접사업비(공급가액)',
  '매입부가세',
  'MYSC인건비',
  'MYSC수익',
  '매출부가세(출금)',
  '팀지원금(출금)',
  '은행이자(출금)',
];
const ACTUAL_LABELS = [
  'MYSC 선입금 - 직접사업비 등(입금)',
  'MYSC 선입금 - MYSC 인건비(입금)',
  'MYSC 선입금 - 매입부가세(입금)',
  ...PROJECTION_LABELS.slice(3, 7),
  'MYSC 선입금 - 직접사업비 등(출금)',
  'MYSC 선입금 - MYSC 인건비(출금)',
  ...PROJECTION_LABELS.slice(9),
];
const LINE_ROWS = {
  projection: [14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  actual: [37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53],
};

function makeOfficialMatrix() {
  const matrix = Array.from({ length: 60 }, () => Array.from({ length: 72 }, () => ''));
  matrix[11][0] = 'Projection';
  matrix[34][0] = 'ACTUAL';
  const annualYears = ['2024년', '2025년', '2027년', '2028년', '2029년', '2030년', '2031년', '2032년'];
  [2, 3, 64, 65, 66, 67, 68, 69].forEach((columnIndex, index) => {
    matrix[11][columnIndex] = annualYears[index];
    matrix[34][columnIndex] = annualYears[index];
  });
  matrix[11][70] = 'Total';
  matrix[34][70] = 'Total';
  for (let index = 0; index < 60; index += 1) {
    const label = `26-${Math.floor(index / 5) + 1}-${(index % 5) + 1}`;
    matrix[12][index + 4] = label;
    matrix[35][index + 4] = label;
  }
  LINE_ROWS.projection.forEach((rowIndex, index) => {
    matrix[rowIndex][0] = PROJECTION_LABELS[index];
  });
  LINE_ROWS.actual.forEach((rowIndex, index) => {
    matrix[rowIndex][0] = ACTUAL_LABELS[index];
  });
  [
    [21, '입금 합계'], [31, '출금 합계'], [32, '잔액 (※ 중요)'],
    [44, '입금 합계'], [54, '출금 합계'], [55, '잔액'],
  ].forEach(([rowIndex, label]) => {
    matrix[rowIndex][0] = label;
  });
  return matrix;
}

describe('cashflow official fixed template', () => {
  it('keeps the week and A1 helpers used by config and snapshots', () => {
    expect(parseCashflowWeekLabel('26-1-1')).toEqual({
      raw: '26-1-1',
      year: 2026,
      month: 1,
      yearMonth: '2026-01',
      weekNo: 1,
    });
    expect(parseCashflowWeekLabel('2026-1-1')).toBeNull();
    expect(toA1(14, 4)).toBe('E15');
    expect(toA1(53, 63)).toBe('BL54');
  });

  it('maps only the official fixed coordinates', () => {
    const result = analyzeCashflowSheetTemplate(makeOfficialMatrix());

    expect(result.supported).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.mappingCandidates).toHaveLength(1_920);
    expect(result.sections.map((section) => section.weekColumns.length)).toEqual([60, 60]);
    expect(result.sections.map((section) => section.annualMappings.length)).toEqual([144, 144]);
    expect(result.sections.map((section) => section.annualDerivedMappings.length)).toEqual([27, 27]);
    expect(result.sections.map((section) => section.totalMappings.length)).toEqual([19, 19]);
    expect(result.sections[0].mappings[0]).toMatchObject({
      mode: 'projection',
      lineId: 'MYSC_PREPAY_IN',
      yearMonth: '2026-01',
      weekNo: 1,
      a1: 'E15',
    });
    expect(result.sections[1].mappings.at(-1)).toMatchObject({
      mode: 'actual',
      lineId: 'BANK_INTEREST_OUT',
      yearMonth: '2026-12',
      weekNo: 5,
      a1: 'BL54',
    });
    expect(result.sections[0].annualColumns.map(({ year, a1 }) => [year, a1])).toEqual([
      [2024, 'C12'], [2025, 'D12'], [2027, 'BM12'], [2028, 'BN12'],
      [2029, 'BO12'], [2030, 'BP12'], [2031, 'BQ12'], [2032, 'BR12'], [2026, 'BS12'],
    ]);
    expect(result.sections[0].totalColumn).toMatchObject({ a1: 'BS12' });
    expect(result.sections[0].annualDerivedMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ year: 2024, periodKind: 'ANNUAL', derivedKind: 'balance', a1: 'C33' }),
      expect.objectContaining({ year: 2025, periodKind: 'ANNUAL', derivedKind: 'balance', a1: 'D33' }),
      expect.objectContaining({ year: 2027, periodKind: 'ANNUAL', derivedKind: 'balance', a1: 'BM33' }),
      expect.objectContaining({ year: 2026, periodKind: 'GRAND_TOTAL', derivedKind: 'balance', a1: 'BS33' }),
    ]));
  });

  it('fails closed instead of guessing when an official coordinate changes', () => {
    const matrix = makeOfficialMatrix();
    matrix[14][0] = '';

    const result = analyzeCashflowSheetTemplate(matrix);

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cashflow_line_invalid',
        mode: 'projection',
        sourceCell: 'A15',
        lineIds: ['MYSC_PREPAY_IN'],
      }),
    ]));
  });

  it('fails when Projection and Actual no longer describe the same 60 weeks', () => {
    const matrix = makeOfficialMatrix();
    matrix[35][63] = '26-12-4';

    const result = analyzeCashflowSheetTemplate(matrix);

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'cashflow_week_headers_mismatch' }),
    ]));
  });

  it('keeps ambiguous labels unresolved at the trust boundary', () => {
    const resolve = buildCashflowLineLookup([
      { lineId: 'LINE_A', label: '공 유 라벨', direction: 'IN', aliases: [] },
      { lineId: 'LINE_B', label: '공유라벨', direction: 'IN', aliases: [] },
    ]);

    expect(resolve('공유라벨', 'projection', 'IN')).toBeNull();
  });
});
