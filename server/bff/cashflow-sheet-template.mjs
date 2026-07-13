import cashflowPolicyData from '../../src/app/policies/cashflow-policy.json' with { type: 'json' };

const WEEK_LABEL_RE = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;
const SUPPORTED_MODES = ['projection', 'actual'];
const MIN_WEEK_LABELS_PER_SECTION = 2;
const LINE_ENTRIES = Array.isArray(cashflowPolicyData.lineEntries) ? cashflowPolicyData.lineEntries : [];
const EXPECTED_LINE_IDS = LINE_ENTRIES.map((entry) => entry.lineId);
const EXPECTED_DERIVED_KINDS = ['deposit_total', 'withdrawal_total', 'balance'];

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
    for (const mode of SUPPORTED_MODES) {
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
    const prefix = `${mode}|${direction}|`;
    const keys = new Set([normalizeText(label), normalizeLabelKey(label)]
      .filter(Boolean)
      .map((normalized) => `${prefix}${normalized}`));
    if ([...keys].some((key) => ambiguousKeys.has(key))) return null;
    for (const key of keys) {
      const entry = entriesByKey.get(key);
      if (entry) return entry;
    }
    return null;
  };
}

const resolveLineEntry = buildCashflowLineLookup(LINE_ENTRIES);

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

export function cashflowMappingKey({ mode, lineId, yearMonth, weekNo }) {
  return [mode, yearMonth, Number(weekNo), lineId].join('|');
}

export function parseCashflowWeekLabel(value) {
  const match = WEEK_LABEL_RE.exec(normalizeText(value));
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNo)) return null;
  if (month < 1 || month > 12 || weekNo < 1 || weekNo > 5) return null;
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

function resolveDerivedKind(label) {
  const normalized = normalizeLabelKey(label);
  if (!normalized) return null;
  if (normalized === '입금합계') return 'deposit_total';
  if (normalized === '출금합계') return 'withdrawal_total';
  if (normalized === '잔액' || normalized === '잔액(※중요)') return 'balance';
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

function resolveModeFromRow(row) {
  const searchLimit = Math.min(6, row?.length || 0);
  for (let index = 0; index < searchLimit; index += 1) {
    const normalized = normalizeLabelKey(row[index]).toLowerCase();
    if (!normalized) continue;
    if (normalized.includes('projection')) return 'projection';
    if (normalized.includes('actual')) return 'actual';
  }
  return null;
}

function detectCashflowSectionCandidates(rows) {
  const sections = [];
  const seenModes = new Set();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const mode = resolveModeFromRow(rows[rowIndex]);
    if (!SUPPORTED_MODES.includes(mode) || seenModes.has(mode)) continue;

    for (let weekRowIndex = rowIndex + 1; weekRowIndex < Math.min(rows.length, rowIndex + 6); weekRowIndex += 1) {
      const weekColumns = detectWeekColumns(rows[weekRowIndex]).map((week) => ({
        ...week,
        rowIndex: weekRowIndex,
        a1: toA1(weekRowIndex, week.columnIndex),
      }));
      if (weekColumns.length < MIN_WEEK_LABELS_PER_SECTION) continue;
      sections.push({
        mode,
        headerRowIndex: rowIndex,
        rowIndex: weekRowIndex,
        weekColumns,
      });
      seenModes.add(mode);
      break;
    }
  }

  return sections.sort((a, b) => a.rowIndex - b.rowIndex);
}

function analyzeSection({ rows, candidate, nextCandidate, mode }) {
  const lineRows = [];
  const derivedRows = [];
  const ignoredRows = [];
  const duplicateLineIds = new Set();
  const seenLineIds = new Set();
  const endRowIndex = nextCandidate?.headerRowIndex ?? rows.length;
  let direction = 'IN';

  for (let rowIndex = candidate.rowIndex + 1; rowIndex < endRowIndex; rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const { label, columnIndex } = readRowLabel(row);
    if (!label) continue;

    const derivedKind = resolveDerivedKind(label);
    if (derivedKind) {
      derivedRows.push({
        rowIndex,
        label,
        labelColumnIndex: columnIndex,
        a1: toA1(rowIndex, columnIndex),
        kind: derivedKind,
      });
      if (derivedKind === 'deposit_total') direction = 'OUT';
      continue;
    }

    const lineEntry = resolveLineEntry(label, mode, direction);
    if (lineEntry) {
      if (seenLineIds.has(lineEntry.lineId)) duplicateLineIds.add(lineEntry.lineId);
      seenLineIds.add(lineEntry.lineId);
      lineRows.push({
        rowIndex,
        label,
        labelColumnIndex: columnIndex,
        a1: toA1(rowIndex, columnIndex),
        lineId: lineEntry.lineId,
        canonicalLabel: lineEntry.label,
        direction: lineEntry.direction,
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
        label: lineRow.label,
        canonicalLabel: lineRow.canonicalLabel,
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
  const cashflowCandidates = detectCashflowSectionCandidates(rows);
  const candidates = cashflowCandidates.length >= 2 ? cashflowCandidates : detectSectionCandidates(rows).slice(0, 2)
    .map((candidate, index) => ({ ...candidate, mode: SUPPORTED_MODES[index], headerRowIndex: Math.max(0, candidate.rowIndex - 1) }));
  const reasons = [];

  if (candidates.length < 2) {
    reasons.push({
      code: 'cashflow_sections_missing',
      message: 'Projection/Actual 섹션의 주차 라벨 행을 찾지 못했습니다.',
    });
  }

  const selectedCandidates = SUPPORTED_MODES
    .map((mode) => candidates.find((candidate) => candidate.mode === mode))
    .filter(Boolean);
  const sections = selectedCandidates.map((candidate, index) => analyzeSection({
    rows,
    candidate,
    nextCandidate: selectedCandidates[index + 1],
    mode: candidate.mode || SUPPORTED_MODES[index],
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

    const lineIds = section.lineRows.map((row) => row.lineId);
    if (lineIds.length !== EXPECTED_LINE_IDS.length
      || lineIds.some((lineId, index) => lineId !== EXPECTED_LINE_IDS[index])) {
      reasons.push({
        code: 'cashflow_line_order_invalid',
        mode: section.mode,
        expectedLineIds: EXPECTED_LINE_IDS,
        actualLineIds: lineIds,
        message: `${section.mode} 섹션 cashflow 라벨 순서가 정책과 다릅니다.`,
      });
    }

    const derivedKinds = section.derivedRows.map((row) => row.kind);
    const missingDerivedKinds = EXPECTED_DERIVED_KINDS.filter((kind) => !derivedKinds.includes(kind));
    const duplicateDerivedKinds = EXPECTED_DERIVED_KINDS.filter(
      (kind) => derivedKinds.filter((candidate) => candidate === kind).length > 1,
    );
    if (missingDerivedKinds.length > 0) {
      reasons.push({
        code: 'cashflow_derived_row_missing',
        mode: section.mode,
        kinds: missingDerivedKinds,
        message: `${section.mode} 섹션 합계/잔액 행이 부족합니다.`,
      });
    }
    if (duplicateDerivedKinds.length > 0) {
      reasons.push({
        code: 'cashflow_derived_row_duplicate',
        mode: section.mode,
        kinds: duplicateDerivedKinds,
        message: `${section.mode} 섹션 합계/잔액 행이 중복되었습니다.`,
      });
    }
    if (missingDerivedKinds.length === 0
      && duplicateDerivedKinds.length === 0
      && derivedKinds.some((kind, index) => kind !== EXPECTED_DERIVED_KINDS[index])) {
      reasons.push({
        code: 'cashflow_derived_row_order_invalid',
        mode: section.mode,
        expectedKinds: EXPECTED_DERIVED_KINDS,
        actualKinds: derivedKinds,
        message: `${section.mode} 섹션 합계/잔액 행 순서가 다릅니다.`,
      });
    }
  }

  if (cashflowCandidates.length > 2) {
    reasons.push({
      code: 'cashflow_extra_week_sections',
      count: cashflowCandidates.length,
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
