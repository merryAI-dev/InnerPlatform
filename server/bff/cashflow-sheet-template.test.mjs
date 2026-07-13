import { describe, expect, it } from 'vitest';
import {
  analyzeCashflowSheetTemplate,
  parseCashflowWeekLabel,
  toA1,
} from './cashflow-sheet-template.mjs';

const PROJECTION_IN_LINES = [
  ['MYSC_PREPAY_IN', 'MYSC 선입금 - 직접사업비 등'],
  ['MYSC_PREPAY_LABOR_IN', 'MYSC 선입금 - MYSC 인건비'],
  ['MYSC_PREPAY_INPUT_VAT_IN', 'MYSC 선입금 - 메입부가세'],
  ['SALES_IN', '매출액(입금)'],
  ['SALES_VAT_IN', '매출부가세(입금)'],
  ['TEAM_SUPPORT_IN', '팀지원금(입금)'],
  ['BANK_INTEREST_IN', '은행이자(입금)'],
];

const PROJECTION_OUT_LINES = [
  ['MYSC_PREPAY_DIRECT_OUT', 'MYSC 선입금 - 직접사업비 등'],
  ['MYSC_PREPAY_LABOR_OUT', 'MYSC 선입금 - MYSC 인건비'],
  ['DIRECT_COST_OUT', '직접사업비(공급가액)'],
  ['INPUT_VAT_OUT', '매입부가세'],
  ['MYSC_LABOR_OUT', 'MYSC인건비'],
  ['MYSC_PROFIT_OUT', 'MYSC수익'],
  ['SALES_VAT_OUT', '매출부가세(출금)'],
  ['TEAM_SUPPORT_OUT', '팀지원금(출금)'],
  ['BANK_INTEREST_OUT', '은행이자(출금)'],
];

const ACTUAL_IN_LINES = [
  ['MYSC_PREPAY_IN', 'MYSC 선입금 - 직접사업비 등(입금)'],
  ['MYSC_PREPAY_LABOR_IN', 'MYSC 선입금 - MYSC 인건비(입금)'],
  ['MYSC_PREPAY_INPUT_VAT_IN', 'MYSC 선입금 - 매입부가세(입금)'],
  ...PROJECTION_IN_LINES.slice(3),
];

const ACTUAL_OUT_LINES = [
  ['MYSC_PREPAY_DIRECT_OUT', 'MYSC 선입금 - 직접사업비 등(출금)'],
  ['MYSC_PREPAY_LABOR_OUT', 'MYSC 선입금 - MYSC 인건비(출금)'],
  ...PROJECTION_OUT_LINES.slice(2),
];

const EXPECTED_LINE_IDS = [...PROJECTION_IN_LINES, ...PROJECTION_OUT_LINES].map(([lineId]) => lineId);

function makeWeekLabels(count, startMonth = 1) {
  const labels = [];
  let month = startMonth;
  let weekNo = 1;
  for (let i = 0; i < count; i += 1) {
    labels.push(`26-${month}-${weekNo}`);
    weekNo += 1;
    if (weekNo > 5) {
      month += 1;
      weekNo = 1;
    }
  }
  return labels;
}

function buildSection({ weekLabels, actual = false, firstWeekColumn = 3, lineOverrides = {} }) {
  const width = firstWeekColumn + weekLabels.length + 5;
  const empty = () => Array.from({ length: width }, () => '');
  const rows = [];
  const header = empty();
  header[0] = actual ? 'ACTUAL' : 'Projection';
  ['2027년 01월', '2027년 02월', '2027년 03월', 'Total', '미입금액'].forEach((label, index) => {
    header[firstWeekColumn + weekLabels.length + index] = label;
  });
  rows.push(header);
  const weekRow = empty();
  weekLabels.forEach((label, index) => {
    weekRow[firstWeekColumn + index] = label;
  });
  rows.push(weekRow);
  const inLines = actual ? ACTUAL_IN_LINES : PROJECTION_IN_LINES;
  const outLines = actual ? ACTUAL_OUT_LINES : PROJECTION_OUT_LINES;
  for (const [lineId, label] of inLines) {
    const row = empty();
    row[0] = lineOverrides[lineId] || label;
    rows.push(row);
  }
  const inTotal = empty();
  inTotal[0] = '입금 합계';
  rows.push(inTotal);
  for (const [lineId, label] of outLines) {
    const row = empty();
    row[0] = lineOverrides[lineId] || label;
    rows.push(row);
  }
  const outTotal = empty();
  outTotal[0] = '출금 합계';
  rows.push(outTotal);
  const balance = empty();
  balance[0] = actual ? '잔액' : '잔액 (※ 중요)';
  rows.push(balance);
  return rows;
}

function buildTemplateMatrix({ weekCount = 60, firstWeekColumn = 3, projectionOverrides = {}, actualOverrides = {} } = {}) {
  return [
    ['사업비 cashflow'],
    ['안내 문구는 매핑 대상이 아닙니다.'],
    [],
    ...buildSection({
      weekLabels: makeWeekLabels(weekCount),
      firstWeekColumn,
      lineOverrides: projectionOverrides,
    }),
    [],
    ...buildSection({
      weekLabels: makeWeekLabels(weekCount),
      firstWeekColumn,
      actual: true,
      lineOverrides: actualOverrides,
    }),
    [],
    ['주의사항', '이 아래 설명은 매핑에서 제외합니다.'],
  ];
}

function buildNonCashflowWeeklyBlock({ weekCount = 60, firstWeekColumn = 3 } = {}) {
  const width = firstWeekColumn + weekCount + 2;
  const empty = () => Array.from({ length: width }, () => '');
  const header = empty();
  header[0] = '사업비 입금예상 (MYSC계좌기준)';
  const weekRow = empty();
  makeWeekLabels(weekCount).forEach((label, index) => {
    weekRow[firstWeekColumn + index] = label;
  });
  const dateRow = empty();
  dateRow[0] = '입금일';
  const amountRow = empty();
  amountRow[0] = '입금액';
  return [header, weekRow, dateRow, amountRow, []];
}

describe('cashflow sheet template mapping', () => {
  it('parses YY-M-W week labels into authoritative join keys', () => {
    expect(parseCashflowWeekLabel('26-1-1')).toEqual({
      raw: '26-1-1',
      year: 2026,
      month: 1,
      yearMonth: '2026-01',
      weekNo: 1,
    });
    expect(parseCashflowWeekLabel('2026-1-1')).toBeNull();
    expect(parseCashflowWeekLabel('26-13-1')).toBeNull();
    expect(parseCashflowWeekLabel('26-1-7')).toBeNull();
  });

  it('builds A1 coordinates without hardcoding a final column', () => {
    expect(toA1(11, 3)).toBe('D12');
    expect(toA1(30, 62)).toBe('BK31');
    expect(toA1(2, 64)).toBe('BM3');
  });

  it('maps the upper section as projection and the lower section as actual', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({ weekCount: 60 }));

    expect(result.supported).toBe(true);
    expect(result.sections.map((section) => section.mode)).toEqual(['projection', 'actual']);
    expect(result.sections[0].weekColumns).toHaveLength(60);
    expect(result.sections[1].weekColumns).toHaveLength(60);
    expect(result.sections[0].lineRows).toHaveLength(16);
    expect(result.sections[1].lineRows).toHaveLength(16);
    expect(result.sections[0].mappings).toHaveLength(960);
    expect(result.sections[1].mappings).toHaveLength(960);
    expect(result.mappingCandidates).toHaveLength(1_920);
    expect(result.sections.map((section) => section.lineRows.map((row) => row.lineId))).toEqual([
      EXPECTED_LINE_IDS,
      EXPECTED_LINE_IDS,
    ]);
    expect(result.mappingCandidates[0]).toMatchObject({
      mode: 'projection',
      lineId: 'MYSC_PREPAY_IN',
      yearMonth: '2026-01',
      weekNo: 1,
      source: 'sheet_layout',
    });
    expect(result.mappingCandidates.some((mapping) => mapping.mode === 'actual')).toBe(true);
    expect(result.sections[0].lineRows
      .filter((row) => row.label === 'MYSC 선입금 - 직접사업비 등')
      .map((row) => row.lineId)).toEqual(['MYSC_PREPAY_IN', 'MYSC_PREPAY_DIRECT_OUT']);
    expect(result.sections[0].lineRows
      .filter((row) => row.label === 'MYSC 선입금 - MYSC 인건비')
      .map((row) => row.lineId)).toEqual(['MYSC_PREPAY_LABOR_IN', 'MYSC_PREPAY_LABOR_OUT']);
    expect(result.sections[0].weekColumns.at(-1).a1).toMatch(/^BK\d+$/);
    expect(result.mappingCandidates.every((mapping) => mapping.columnIndex <= 62)).toBe(true);
    expect(result.stats.maxColumnCount).toBe(68);
  });

  it('ignores a non-cashflow weekly block above the Projection header', () => {
    const result = analyzeCashflowSheetTemplate([
      ['최종 업데이트'],
      ...buildNonCashflowWeeklyBlock({ weekCount: 60 }),
      ...buildTemplateMatrix({ weekCount: 60 }),
    ]);

    expect(result.supported).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.sections.map((section) => section.mode)).toEqual(['projection', 'actual']);
    expect(result.sections[0]).toMatchObject({
      mode: 'projection',
      lineRows: expect.arrayContaining([
        expect.objectContaining({
          label: 'MYSC 선입금 - 직접사업비 등',
          canonicalLabel: 'MYSC 선입금(잔금 등 입금 필요 시)',
          lineId: 'MYSC_PREPAY_IN',
        }),
      ]),
    });
    expect(result.sections[0].lineRows).toHaveLength(16);
    expect(result.sections[1].lineRows).toHaveLength(16);
  });

  it('scans weekly columns dynamically when the last column is not BK', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({ weekCount: 8, firstWeekColumn: 5 }));

    expect(result.supported).toBe(true);
    expect(result.sections[0].weekColumns).toHaveLength(8);
    expect(result.sections[0].weekColumns[0].a1).toMatch(/^F\d+$/);
    expect(result.sections[0].weekColumns.at(-1).a1).not.toMatch(/^BK\d+$/);
    expect(result.sections[0].mappings).toHaveLength(128);
    expect(result.sections[1].mappings).toHaveLength(128);
  });

  it('separates totals and balance rows from cashflow line mappings', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({ weekCount: 4 }));

    expect(result.derivedRows.map((row) => `${row.mode}:${row.kind}`)).toEqual([
      'projection:deposit_total',
      'projection:withdrawal_total',
      'projection:balance',
      'actual:deposit_total',
      'actual:withdrawal_total',
      'actual:balance',
    ]);
    expect(result.mappingCandidates.some((mapping) => String(mapping.lineId).includes('합계'))).toBe(false);
    expect(result.mappingCandidates).toHaveLength(128);
  });

  it('rejects missing cashflow labels with specific reasons', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({
      weekCount: 4,
      projectionOverrides: { SALES_IN: '알 수 없는 입금 라벨' },
    }));

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cashflow_line_missing',
        mode: 'projection',
        lineIds: expect.arrayContaining(['SALES_IN']),
      }),
    ]));
  });

  it('does not resolve a label from the wrong direction', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({
      weekCount: 4,
      projectionOverrides: { MYSC_PREPAY_LABOR_IN: 'MYSC 선입금 - MYSC 인건비(출금)' },
    }));

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cashflow_line_missing',
        mode: 'projection',
        lineIds: expect.arrayContaining(['MYSC_PREPAY_LABOR_IN']),
      }),
    ]));
  });

  it('rejects duplicate cashflow labels inside a section', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({
      weekCount: 4,
      actualOverrides: { BANK_INTEREST_IN: '매출액(입금)' },
    }));

    expect(result.supported).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cashflow_line_duplicate',
        mode: 'actual',
        lineIds: expect.arrayContaining(['SALES_IN']),
      }),
    ]));
  });
});
