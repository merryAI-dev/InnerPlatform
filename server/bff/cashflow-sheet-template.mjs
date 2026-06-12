import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };

const WEEK_LABEL_RE = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;
const SUPPORTED_MODES = ['projection', 'actual'];
const MIN_WEEK_LABELS_PER_SECTION = 2;
const LINE_ENTRIES = Array.isArray(cashflowPolicyData.lineEntries) ? cashflowPolicyData.lineEntries : [];
const EXPECTED_LINE_IDS = LINE_ENTRIES.map((entry) => entry.lineId);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeLabelKey(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

const LINE_BY_LABEL = new Map();
const LINE_ENTRY_BY_ID = new Map();
for (const entry of LINE_ENTRIES) {
  LINE_ENTRY_BY_ID.set(entry.lineId, entry);
  for (const label of [entry.lineId, entry.label, ...(entry.aliases || [])]) {
    const normalized = normalizeText(label);
    if (normalized) LINE_BY_LABEL.set(normalized, entry);
    const stripped = normalizeLabelKey(label);
    if (stripped) LINE_BY_LABEL.set(stripped, entry);
  }
}

function columnName(columnIndex) {
  let n = columnIndex + 1;
  let name = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function toA1(rowIndex, columnIndex) {
  return `${columnName(columnIndex)}${rowIndex + 1}`;
}

export function parseCashflowWeekLabel(value) {
  const match = WEEK_LABEL_RE.exec(normalizeText(value));
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return null;
  if (month < 1 || month > 12 || weekNo < 1 || weekNo > 6) return null;
  return {
    raw: normalizeText(value),
    year: 2000 + year,
    month,
    yearMonth: `${2000 + year}-${String(month).padStart(2, '0')}`,
    weekNo,
  };
}

function detectWeekColumns(row) {
  return (row || [])
    .map((cell, columnIndex) => {
      const parsed = parseCashflowWeekLabel(cell);
      if (!parsed) return null;
      return {
        ...parsed,
        columnIndex,
        a1: toA1(0, columnIndex).replace(/\d+$/, ''),
      };
    })
    .filter(Boolean);
}

function readRowLabel(row) {
  const searchLimit = Math.min(4, row?.length || 0);
  for (let index = 0; index < searchLimit; index += 1) {
    const label = normalizeText(row[index]);
    if (label) return { label, columnIndex: index };
  }
  return { label: '', columnIndex: -1 };
}

function resolveLineEntry(label) {
  const normalized = normalizeText(label);
  if (!normalized) return null;
  return LINE_BY_LABEL.get(normalized) || LINE_BY_LABEL.get(normalizeLabelKey(normalized)) || null;
}

function resolveDerivedKind(label) {
  const normalized = normalizeLabelKey(label);
  if (!normalized) return null;
  if (normalized.includes('입금합계')) return 'deposit_total';
  if (normalized.includes('출금합계')) return 'withdrawal_total';
  if (normalized.includes('잔액')) return 'balance';
  return null;
}

function normalizeMatrix(matrix) {
  return Array.isArray(matrix)
    ? matrix.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
    : [];
}

function detectSectionCandidates(rows) {
  return rows
    .map((row, rowIndex) => {
      const weekColumns = detectWeekColumns(row).map((week) => ({
        ...week,
        rowIndex,
        a1: toA1(rowIndex, week.columnIndex),
      }));
      if (weekColumns.length < MIN_WEEK_LABELS_PER_SECTION) return null;
      return { rowIndex, weekColumns };
    })
    .filter(Boolean)
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

function analyzeSection({ rows, candidate, nextCandidateRowIndex, mode }) {
  const lineRows = [];
  const derivedRows = [];
  const ignoredRows = [];
  const duplicateLineIds = new Set();
  const seenLineIds = new Set();
  const endRowIndex = nextCandidateRowIndex ?? rows.length;

  for (let rowIndex = candidate.rowIndex + 1; rowIndex < endRowIndex; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const { label, columnIndex } = readRowLabel(row);
    if (!label) continue;

    const lineEntry = resolveLineEntry(label);
    if (lineEntry) {
      if (seenLineIds.has(lineEntry.lineId)) duplicateLineIds.add(lineEntry.lineId);
      seenLineIds.add(lineEntry.lineId);
      lineRows.push({
        rowIndex,
        label,
        labelColumnIndex: columnIndex,
        a1: toA1(rowIndex, columnIndex),
        lineId: lineEntry.lineId,
        direction: lineEntry.direction,
      });
      continue;
    }

    const derivedKind = resolveDerivedKind(label);
    if (derivedKind) {
      derivedRows.push({
        rowIndex,
        label,
        labelColumnIndex: columnIndex,
        a1: toA1(rowIndex, columnIndex),
        kind: derivedKind,
      });
      continue;
    }

    ignoredRows.push({
      rowIndex,
      label,
      labelColumnIndex: columnIndex,
      a1: toA1(rowIndex, columnIndex),
      reason: 'unmapped_row_label',
    });
  }

  const mappings = [];
  for (const lineRow of lineRows) {
    for (const week of candidate.weekColumns) {
      mappings.push({
        mode,
        lineId: lineRow.lineId,
        direction: lineRow.direction,
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        rowIndex: lineRow.rowIndex,
        columnIndex: week.columnIndex,
        a1: toA1(lineRow.rowIndex, week.columnIndex),
        source: 'sheet_layout',
      });
    }
  }

  const missingLineIds = EXPECTED_LINE_IDS.filter((lineId) => !seenLineIds.has(lineId));

  return {
    mode,
    headerRowIndex: Math.max(0, candidate.rowIndex - 1),
    weekRowIndex: candidate.rowIndex,
    weekColumns: candidate.weekColumns,
    lineRows,
    derivedRows,
    ignoredRows,
    mappings,
    missingLineIds,
    duplicateLineIds: Array.from(duplicateLineIds),
  };
}

export function analyzeCashflowSheetTemplate(matrix) {
  const rows = normalizeMatrix(matrix);
  const candidates = detectSectionCandidates(rows);
  const reasons = [];

  if (candidates.length < 2) {
    reasons.push({
      code: 'cashflow_sections_missing',
      message: 'Projection/Actual 섹션의 주차 라벨 행을 찾지 못했습니다.',
    });
  }

  const selectedCandidates = candidates.slice(0, 2);
  const sections = selectedCandidates.map((candidate, index) => analyzeSection({
    rows,
    candidate,
    nextCandidateRowIndex: selectedCandidates[index + 1]?.rowIndex,
    mode: SUPPORTED_MODES[index],
  }));

  for (const section of sections) {
    if (section.missingLineIds.length > 0) {
      reasons.push({
        code: 'cashflow_line_missing',
        mode: section.mode,
        lineIds: section.missingLineIds,
        message: `${section.mode} 섹션에서 cashflow 라벨을 찾지 못했습니다.`,
      });
    }
    if (section.duplicateLineIds.length > 0) {
      reasons.push({
        code: 'cashflow_line_duplicate',
        mode: section.mode,
        lineIds: section.duplicateLineIds,
        message: `${section.mode} 섹션에 중복 cashflow 라벨이 있습니다.`,
      });
    }
  }

  if (candidates.length > 2) {
    reasons.push({
      code: 'cashflow_extra_week_sections',
      count: candidates.length,
      message: '지원 템플릿보다 많은 주차 라벨 섹션이 감지되었습니다.',
    });
  }

  const mappingCandidates = sections.flatMap((section) => section.mappings);
  const ignoredRows = sections.flatMap((section) => section.ignoredRows.map((row) => ({ ...row, mode: section.mode })));
  const derivedRows = sections.flatMap((section) => section.derivedRows.map((row) => ({ ...row, mode: section.mode })));
  const supported = sections.length === 2 && reasons.length === 0;

  return {
    supported,
    policyVersion: cashflowPolicyData.version || 'cashflow-policy-v1',
    sectionOrder: ['projection', 'actual'],
    sections,
    mappingCandidates,
    derivedRows,
    ignoredRows,
    reasons,
    stats: {
      rowCount: rows.length,
      maxColumnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
      sectionCount: sections.length,
      mappingCount: mappingCandidates.length,
    },
  };
}
