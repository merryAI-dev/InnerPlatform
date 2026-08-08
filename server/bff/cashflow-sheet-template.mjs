import cashflowPolicyData from '../../policies/cashflow-policy.json' with { type: 'json' };
import {
  CashflowTemplateMismatchError,
  annualYearsFor,
  lineIndexOfRow,
  lineRowFor,
} from './cashflow-coordinates.mjs';

const WEEK_LABEL_RE = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;
const LINE_ENTRIES = Array.isArray(cashflowPolicyData.lineEntries) ? cashflowPolicyData.lineEntries : [];
const WEEK_COLUMN_INDEXES = Array.from({ length: 60 }, (_, index) => index + 4); // E:BL
const ANNUAL_COLUMN_INDEXES = [2, 3, 64, 65, 66, 67, 68, 69]; // C:D, BM:BR
const SOURCE_YEAR_TOTAL_COLUMN_INDEX = 70; // BS
const SECTION_LAYOUTS = [
  {
    mode: 'projection',
    headerRowIndex: 11,
    weekRowIndex: 12,
    derivedRows: [
      { rowIndex: 21, kind: 'deposit_total', label: '입금 합계' },
      { rowIndex: 31, kind: 'withdrawal_total', label: '출금 합계' },
      { rowIndex: 32, kind: 'balance', label: '잔액 (※ 중요)' },
    ],
  },
  {
    mode: 'actual',
    headerRowIndex: 34,
    weekRowIndex: 35,
    derivedRows: [
      { rowIndex: 44, kind: 'deposit_total', label: '입금 합계' },
      { rowIndex: 54, kind: 'withdrawal_total', label: '출금 합계' },
      { rowIndex: 55, kind: 'balance', label: '잔액' },
    ],
  },
];

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabelKey(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function columnName(columnIndex) {
  let number = columnIndex + 1;
  let name = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

export function toA1(rowIndex, columnIndex) {
  return `${columnName(columnIndex)}${rowIndex + 1}`;
}

export function cashflowMappingKey({ mode, lineId, yearMonth, weekNo }) {
  return [mode, yearMonth, Number(weekNo), lineId].join('|');
}

export function parseCashflowWeekLabel(value) {
  const match = WEEK_LABEL_RE.exec(normalizeText(value));
  if (!match) return null;
  const year = 2000 + Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || weekNo < 1 || weekNo > 5) return null;
  return {
    raw: normalizeText(value),
    year,
    month,
    yearMonth: `${year}-${String(month).padStart(2, '0')}`,
    weekNo,
  };
}

function fixedSection(matrix, layout, reasons) {
  const sourceYear = parseCashflowWeekLabel(matrix?.[layout.weekRowIndex]?.[WEEK_COLUMN_INDEXES[0]])?.year;
  const weekColumns = WEEK_COLUMN_INDEXES.map((columnIndex, index) => {
    const header = String(matrix?.[layout.weekRowIndex]?.[columnIndex] ?? '');
    const parsed = parseCashflowWeekLabel(header);
    const expectedLabel = Number.isSafeInteger(sourceYear)
      ? `${String(sourceYear).slice(-2)}-${Math.floor(index / 5) + 1}-${index % 5 + 1}`
      : '';
    if (!parsed || header !== expectedLabel) {
      throw new CashflowTemplateMismatchError(
        `${toA1(layout.weekRowIndex, columnIndex)} 주차 헤더가 좌표 계약과 다릅니다.`,
      );
    }
    return {
      ...parsed,
      rowIndex: layout.weekRowIndex,
      columnIndex,
      a1: toA1(layout.weekRowIndex, columnIndex),
    };
  });

  const annualYears = annualYearsFor(sourceYear);
  const annualColumns = ANNUAL_COLUMN_INDEXES.map((columnIndex, index) => {
    const year = annualYears[index];
    if (matrix?.[layout.headerRowIndex]?.[columnIndex] !== `${year}년`) {
      throw new CashflowTemplateMismatchError(
        `${toA1(layout.headerRowIndex, columnIndex)} 연간 헤더가 좌표 계약과 다릅니다.`,
      );
    }
    return {
      year,
      periodKind: 'ANNUAL',
      columnIndex,
      a1: toA1(layout.headerRowIndex, columnIndex),
    };
  });
  if (matrix?.[layout.headerRowIndex]?.[SOURCE_YEAR_TOTAL_COLUMN_INDEX] !== 'Total') {
    throw new CashflowTemplateMismatchError(
      `${toA1(layout.headerRowIndex, SOURCE_YEAR_TOTAL_COLUMN_INDEX)} 합계 헤더가 좌표 계약과 다릅니다.`,
    );
  }
  const totalColumn = {
    columnIndex: SOURCE_YEAR_TOTAL_COLUMN_INDEX,
    a1: toA1(layout.headerRowIndex, SOURCE_YEAR_TOTAL_COLUMN_INDEX),
  };
  // The source-year Total is retained as an annual reconciliation input as well as
  // a display-only grand total. It must never replace the weekly source of truth.
  if (totalColumn) {
    annualColumns.push({
      year: sourceYear,
      periodKind: 'GRAND_TOTAL',
      columnIndex: totalColumn.columnIndex,
      a1: totalColumn.a1,
    });
  }
  const lineRows = LINE_ENTRIES.map((_, index) => {
    const rowIndex = lineRowFor(layout.mode, index);
    const expected = LINE_ENTRIES[lineIndexOfRow(layout.mode, rowIndex)];
    const label = String(matrix?.[rowIndex]?.[0] ?? '');
    const expectedLabel = layout.mode === 'projection'
      ? expected?.projectionLabel || expected?.label
      : expected?.actualLabel || expected?.label;
    if (!expected || label !== expectedLabel) {
      throw new CashflowTemplateMismatchError(
        `${toA1(rowIndex, 0)} 항목 라벨이 좌표 계약과 다릅니다.`,
      );
    }
    return {
      rowIndex,
      label,
      canonicalLabel: expected?.label,
      labelColumnIndex: 0,
      a1: toA1(rowIndex, 0),
      lineId: expected?.lineId,
      direction: expected?.direction,
    };
  }).filter((row) => row.lineId && row.direction);

  const derivedRows = layout.derivedRows.map((row) => {
    const label = normalizeText(matrix?.[row.rowIndex]?.[0]);
    if (normalizeLabelKey(label) !== normalizeLabelKey(row.label)) {
      reasons.push({
        code: 'cashflow_derived_row_invalid',
        mode: layout.mode,
        sourceCell: toA1(row.rowIndex, 0),
        message: `${layout.mode} 합계/잔액 행이 공식 양식과 다릅니다.`,
      });
    }
    return {
      ...row,
      label,
      labelColumnIndex: 0,
      a1: toA1(row.rowIndex, 0),
    };
  });

  const mappings = lineRows.flatMap((lineRow) => weekColumns.map((week) => ({
    mode: layout.mode,
    lineId: lineRow.lineId,
    label: lineRow.label,
    canonicalLabel: lineRow.canonicalLabel,
    direction: lineRow.direction,
    yearMonth: week.yearMonth,
    weekNo: week.weekNo,
    rowIndex: lineRow.rowIndex,
    columnIndex: week.columnIndex,
    a1: toA1(lineRow.rowIndex, week.columnIndex),
    source: 'sheet_layout',
  })));
  const annualMappings = lineRows.flatMap((lineRow) => annualColumns.map((column) => ({
    mode: layout.mode,
    lineId: lineRow.lineId,
    label: lineRow.label,
    canonicalLabel: lineRow.canonicalLabel,
    direction: lineRow.direction,
    year: column.year,
    periodKind: column.periodKind,
    rowIndex: lineRow.rowIndex,
    columnIndex: column.columnIndex,
    a1: toA1(lineRow.rowIndex, column.columnIndex),
    source: 'sheet_annual_total',
  })));
  const annualDerivedMappings = derivedRows.flatMap((row) => annualColumns.map((column) => ({
    mode: layout.mode,
    derivedKind: row.kind,
    label: row.label,
    year: column.year,
    periodKind: column.periodKind,
    rowIndex: row.rowIndex,
    columnIndex: column.columnIndex,
    a1: toA1(row.rowIndex, column.columnIndex),
    source: 'sheet_annual_derived',
  })));
  const totalMappings = [
    ...lineRows.map((lineRow) => ({
      mode: layout.mode,
      lineId: lineRow.lineId,
      direction: lineRow.direction,
      rowIndex: lineRow.rowIndex,
      columnIndex: totalColumn?.columnIndex,
      a1: totalColumn ? toA1(lineRow.rowIndex, totalColumn.columnIndex) : '',
      source: 'sheet_grand_total',
      kind: 'line',
    })),
    ...derivedRows.map((row) => ({
      mode: layout.mode,
      rowIndex: row.rowIndex,
      columnIndex: totalColumn?.columnIndex,
      a1: totalColumn ? toA1(row.rowIndex, totalColumn.columnIndex) : '',
      source: 'sheet_grand_total',
      kind: 'derived',
      derivedKind: row.kind,
    })),
  ];

  return {
    mode: layout.mode,
    headerRowIndex: layout.headerRowIndex,
    weekRowIndex: layout.weekRowIndex,
    weekColumns,
    annualColumns,
    totalColumn,
    lineRows,
    derivedRows,
    ignoredRows: [],
    mappings,
    annualMappings,
    annualDerivedMappings,
    totalMappings,
    missingLineIds: [],
    duplicateLineIds: [],
  };
}

export function analyzeCashflowSheetTemplate(matrix) {
  const rows = Array.isArray(matrix)
    ? matrix.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
    : [];
  const reasons = [];
  const sections = SECTION_LAYOUTS.map((layout) => fixedSection(rows, layout, reasons));
  const projectionWeeks = sections[0].weekColumns.map((week) => week.raw);
  const actualWeeks = sections[1].weekColumns.map((week) => week.raw);
  if (JSON.stringify(projectionWeeks) !== JSON.stringify(actualWeeks)) {
    throw new CashflowTemplateMismatchError('Projection과 Actual 주차 헤더가 일치하지 않습니다.');
  }

  const projectionYears = sections[0].annualColumns.map((column) => column.year);
  const actualYears = sections[1].annualColumns.map((column) => column.year);
  if (JSON.stringify(projectionYears) !== JSON.stringify(actualYears)) {
    throw new CashflowTemplateMismatchError('Projection과 Actual 연간 합계 헤더가 일치하지 않습니다.');
  }

  const mappingCandidates = sections.flatMap((section) => section.mappings);
  return {
    supported: reasons.length === 0,
    policyVersion: cashflowPolicyData.version || 'cashflow-policy-v1',
    sectionOrder: ['projection', 'actual'],
    sections,
    mappingCandidates,
    derivedRows: sections.flatMap((section) => section.derivedRows.map((row) => ({ ...row, mode: section.mode }))),
    ignoredRows: [],
    reasons,
    stats: {
      rowCount: rows.length,
      maxColumnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
      sectionCount: sections.length,
      mappingCount: mappingCandidates.length,
    },
  };
}
