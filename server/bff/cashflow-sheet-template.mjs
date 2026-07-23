import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };

const WEEK_LABEL_RE = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;
const ANNUAL_YEAR_LABEL_RE = /^(\d{4})년$/;
const MODES = ['projection', 'actual'];
const LINE_ENTRIES = Array.isArray(cashflowPolicyData.lineEntries) ? cashflowPolicyData.lineEntries : [];
const WEEK_COLUMN_INDEXES = Array.from({ length: 60 }, (_, index) => index + 4); // E:BL
const ANNUAL_COLUMN_INDEXES = [2, 3, 64, 65, 66, 67, 68, 69]; // C:D, BM:BR
const SOURCE_YEAR_TOTAL_COLUMN_INDEX = 70; // BS
const SECTION_LAYOUTS = [
  {
    mode: 'projection',
    headerRowIndex: 11,
    weekRowIndex: 12,
    lineRowIndexes: [14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30],
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
    lineRowIndexes: [37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53],
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

export function buildCashflowLineLookup(lineEntries) {
  const entriesByKey = new Map();
  const ambiguousKeys = new Set();

  for (const entry of lineEntries) {
    for (const mode of MODES) {
      const modeLabel = mode === 'projection' ? entry.projectionLabel : entry.actualLabel;
      for (const label of [entry.lineId, entry.label, ...(entry.aliases || []), modeLabel]) {
        for (const normalized of new Set([normalizeText(label), normalizeLabelKey(label)].filter(Boolean))) {
          const key = `${mode}|${entry.direction}|${normalized}`;
          const existing = entriesByKey.get(key);
          if (existing && existing.lineId !== entry.lineId) {
            entriesByKey.delete(key);
            ambiguousKeys.add(key);
          } else if (!ambiguousKeys.has(key)) {
            entriesByKey.set(key, entry);
          }
        }
      }
    }
  }

  return (label, mode, direction) => {
    for (const normalized of [normalizeText(label), normalizeLabelKey(label)].filter(Boolean)) {
      const key = `${mode}|${direction}|${normalized}`;
      if (ambiguousKeys.has(key)) return null;
      const entry = entriesByKey.get(key);
      if (entry) return entry;
    }
    return null;
  };
}

const resolveLineEntry = buildCashflowLineLookup(LINE_ENTRIES);

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

function annualColumn(matrix, rowIndex, columnIndex) {
  const match = ANNUAL_YEAR_LABEL_RE.exec(normalizeText(matrix?.[rowIndex]?.[columnIndex]));
  if (!match) return null;
  return {
    year: Number.parseInt(match[1], 10),
    columnIndex,
    a1: toA1(rowIndex, columnIndex),
  };
}

function fixedSection(matrix, layout, reasons) {
  const weekColumns = WEEK_COLUMN_INDEXES.map((columnIndex) => {
    const parsed = parseCashflowWeekLabel(matrix?.[layout.weekRowIndex]?.[columnIndex]);
    if (!parsed) {
      reasons.push({
        code: 'cashflow_week_header_invalid',
        mode: layout.mode,
        sourceCell: toA1(layout.weekRowIndex, columnIndex),
        message: `${layout.mode} 주차 헤더가 공식 양식과 다릅니다.`,
      });
      return null;
    }
    return {
      ...parsed,
      rowIndex: layout.weekRowIndex,
      columnIndex,
      a1: toA1(layout.weekRowIndex, columnIndex),
    };
  }).filter(Boolean);

  const annualColumns = ANNUAL_COLUMN_INDEXES
    .map((columnIndex) => annualColumn(matrix, layout.headerRowIndex, columnIndex))
    .filter(Boolean);
  const sourceYear = weekColumns[0]?.year;
  const sourceTotalHeader = normalizeText(matrix?.[layout.headerRowIndex]?.[SOURCE_YEAR_TOTAL_COLUMN_INDEX]);
  if (Number.isSafeInteger(sourceYear) && ['Total', `${sourceYear}년 합계`].includes(sourceTotalHeader)) {
    annualColumns.push({
      year: sourceYear,
      columnIndex: SOURCE_YEAR_TOTAL_COLUMN_INDEX,
      a1: toA1(layout.headerRowIndex, SOURCE_YEAR_TOTAL_COLUMN_INDEX),
    });
  }
  if (annualColumns.length !== ANNUAL_COLUMN_INDEXES.length + 1) {
    reasons.push({
      code: 'cashflow_annual_header_invalid',
      mode: layout.mode,
      message: `${layout.mode} 연간 합계 헤더가 공식 양식과 다릅니다.`,
    });
  }

  const lineRows = layout.lineRowIndexes.map((rowIndex, index) => {
    const expected = LINE_ENTRIES[index];
    const label = normalizeText(matrix?.[rowIndex]?.[0]);
    const resolved = expected ? resolveLineEntry(label, layout.mode, expected.direction) : null;
    if (!expected || resolved?.lineId !== expected.lineId) {
      reasons.push({
        code: 'cashflow_line_invalid',
        mode: layout.mode,
        sourceCell: toA1(rowIndex, 0),
        lineIds: expected ? [expected.lineId] : [],
        message: `${layout.mode} 항목 행이 공식 양식과 다릅니다.`,
      });
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
    rowIndex: lineRow.rowIndex,
    columnIndex: column.columnIndex,
    a1: toA1(lineRow.rowIndex, column.columnIndex),
    source: 'sheet_annual_total',
  })));

  return {
    mode: layout.mode,
    headerRowIndex: layout.headerRowIndex,
    weekRowIndex: layout.weekRowIndex,
    weekColumns,
    annualColumns,
    lineRows,
    derivedRows,
    ignoredRows: [],
    mappings,
    annualMappings,
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
  if (projectionWeeks.length !== 60 || JSON.stringify(projectionWeeks) !== JSON.stringify(actualWeeks)) {
    reasons.push({
      code: 'cashflow_week_headers_mismatch',
      message: 'Projection과 Actual 주차 헤더가 일치하지 않습니다.',
    });
  }

  const projectionYears = sections[0].annualColumns.map((column) => column.year);
  const actualYears = sections[1].annualColumns.map((column) => column.year);
  if (JSON.stringify(projectionYears) !== JSON.stringify(actualYears)) {
    reasons.push({
      code: 'cashflow_annual_headers_mismatch',
      message: 'Projection과 Actual 연간 합계 헤더가 일치하지 않습니다.',
    });
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
