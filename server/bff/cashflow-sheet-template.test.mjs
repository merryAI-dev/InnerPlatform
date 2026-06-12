import { describe, expect, it } from 'vitest';
import {
  analyzeCashflowSheetTemplate,
  parseCashflowWeekLabel,
  toA1,
} from './cashflow-sheet-template.mjs';

const IN_LABELS = [
  'MYSC 선입금(잔금 등 입금 필요 시)',
  '매출액(입금)',
  '매출부가세(입금)',
  '팀지원금(입금)',
  '은행이자(입금)',
];

const OUT_LABELS = [
  '직접사업비(공급가액)',
  '매입부가세',
  'MYSC인건비',
  'MYSC수익(간접비등)',
  '매출부가세(출금)',
  '팀지원금(출금)',
  '은행이자(출금)',
];

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

function buildSection({ weekLabels, actual = false, firstWeekColumn = 3, labelOverride = {} }) {
  const width = firstWeekColumn + weekLabels.length + 2;
  const empty = () => Array.from({ length: width }, () => '');
  const rows = [];
  const header = empty();
  header[0] = actual ? 'ACTUAL' : 'Projection';
  rows.push(header);
  const weekRow = empty();
  weekLabels.forEach((label, index) => {
    weekRow[firstWeekColumn + index] = label;
  });
  rows.push(weekRow);
  for (const label of IN_LABELS) {
    const row = empty();
    row[0] = labelOverride[label] || label;
    rows.push(row);
  }
  const inTotal = empty();
  inTotal[0] = '입금 합계';
  rows.push(inTotal);
  for (const label of OUT_LABELS) {
    const row = empty();
    row[0] = labelOverride[label] || label;
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
      labelOverride: projectionOverrides,
    }),
    [],
    ...buildSection({
      weekLabels: makeWeekLabels(weekCount),
      firstWeekColumn,
      actual: true,
      labelOverride: actualOverrides,
    }),
    [],
    ['주의사항', '이 아래 설명은 매핑에서 제외합니다.'],
  ];
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
    expect(result.sections[0].lineRows).toHaveLength(12);
    expect(result.sections[1].lineRows).toHaveLength(12);
    expect(result.sections[0].mappings).toHaveLength(720);
    expect(result.sections[1].mappings).toHaveLength(720);
    expect(result.mappingCandidates[0]).toMatchObject({
      mode: 'projection',
      lineId: 'MYSC_PREPAY_IN',
      yearMonth: '2026-01',
      weekNo: 1,
      source: 'sheet_layout',
    });
    expect(result.mappingCandidates.some((mapping) => mapping.mode === 'actual')).toBe(true);
  });

  it('scans weekly columns dynamically when the last column is not BK', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({ weekCount: 8, firstWeekColumn: 5 }));

    expect(result.supported).toBe(true);
    expect(result.sections[0].weekColumns).toHaveLength(8);
    expect(result.sections[0].weekColumns[0].a1).toMatch(/^F\d+$/);
    expect(result.sections[0].weekColumns.at(-1).a1).not.toMatch(/^BK\d+$/);
    expect(result.sections[0].mappings).toHaveLength(96);
    expect(result.sections[1].mappings).toHaveLength(96);
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
  });

  it('rejects missing cashflow labels with specific reasons', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({
      weekCount: 4,
      projectionOverrides: { '매출액(입금)': '알 수 없는 입금 라벨' },
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

  it('rejects duplicate cashflow labels inside a section', () => {
    const result = analyzeCashflowSheetTemplate(buildTemplateMatrix({
      weekCount: 4,
      actualOverrides: { '은행이자(입금)': '매출액(입금)' },
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
