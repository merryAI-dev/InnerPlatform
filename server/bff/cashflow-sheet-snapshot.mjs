import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => [key, canonicalize(value[key])]));
}

function revisionOf(value) {
  const serialized = JSON.stringify(canonicalize(value));
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

function normalizedText(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export function classifyCashflowSheetCell(value) {
  const rawValue = normalizedText(value);
  if (!rawValue || /^[-–—―]+$/.test(rawValue)) return { state: 'EMPTY' };

  const normalizedMinus = rawValue.replace(/[−﹣－]/g, '-');
  const parenthesizedNegative = /^\(.*\)$/.test(normalizedMinus);
  if ((normalizedMinus.includes('(') || normalizedMinus.includes(')')) && !parenthesizedNegative) {
    return { state: 'INVALID', rawValue };
  }

  let numericText = normalizedMinus
    .replace(/[()]/g, '')
    .replace(/[,\s\u00a0원₩￦]/g, '');
  if (numericText.endsWith('-') && numericText.length > 1) {
    numericText = `-${numericText.slice(0, -1)}`;
  }
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(numericText)) {
    return { state: 'INVALID', rawValue };
  }

  const parsed = Number(numericText);
  if (!Number.isFinite(parsed)) return { state: 'INVALID', rawValue };
  const amount = parenthesizedNegative && parsed > 0 ? -parsed : parsed;
  return { state: 'VALUE', amount: Object.is(amount, -0) ? 0 : amount };
}

function normalizedAmounts(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, amount]) => typeof amount === 'number' && Number.isFinite(amount))
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function computeCashflowTargetRevision(snapshot = {}) {
  const weeks = (Array.isArray(snapshot?.weeks) ? snapshot.weeks : [])
    .map((week) => ({
      yearMonth: String(week?.yearMonth || ''),
      weekNo: Number(week?.weekNo),
      projection: normalizedAmounts(week?.projection),
      actual: normalizedAmounts(week?.actual),
      adminClosed: Boolean(week?.adminClosed),
    }))
    .filter((week) => week.yearMonth && Number.isFinite(week.weekNo))
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth) || left.weekNo - right.weekNo);
  return revisionOf({ weeks });
}

function snapshotCell(mapping, matrix) {
  const classified = classifyCashflowSheetCell(matrix?.[mapping.rowIndex]?.[mapping.columnIndex]);
  return {
    mode: mapping.mode,
    yearMonth: mapping.yearMonth,
    weekNo: Number(mapping.weekNo),
    lineId: mapping.lineId,
    direction: mapping.direction,
    sourceCell: mapping.a1,
    sourceLabel: mapping.label || mapping.canonicalLabel || mapping.lineId,
    ...classified,
  };
}

function compareCells(left, right) {
  return String(left.mode).localeCompare(String(right.mode))
    || String(left.yearMonth).localeCompare(String(right.yearMonth))
    || Number(left.weekNo) - Number(right.weekNo)
    || String(left.lineId).localeCompare(String(right.lineId));
}

export function createCashflowPinnedSnapshot({
  projectId,
  spreadsheetId,
  spreadsheetTitle,
  selectedSheetName,
  mappings = [],
  matrix = [],
  targetSnapshot = {},
  capturedAt,
  capturedBy = {},
} = {}) {
  const cells = mappings.map((mapping) => snapshotCell(mapping, matrix)).sort(compareCells);
  const sourceRevision = revisionOf({ spreadsheetId, selectedSheetName, cells });
  const summary = cells.reduce((counts, cell) => {
    counts.cellCount += 1;
    if (cell.state === 'VALUE') counts.valueCount += 1;
    if (cell.state === 'EMPTY') counts.emptyCount += 1;
    if (cell.state === 'INVALID') counts.invalidCount += 1;
    return counts;
  }, { cellCount: 0, valueCount: 0, emptyCount: 0, invalidCount: 0 });

  return {
    schemaVersion: 1,
    projectId,
    spreadsheetId,
    spreadsheetTitle,
    selectedSheetName,
    status: 'FRESH',
    sourceRevision,
    targetRevisionAtFetch: computeCashflowTargetRevision(targetSnapshot),
    capturedAt,
    capturedBy: {
      uid: String(capturedBy?.uid || ''),
      email: String(capturedBy?.email || ''),
      role: String(capturedBy?.role || ''),
    },
    yearMonths: [...new Set(cells.map((cell) => cell.yearMonth))].sort(),
    summary,
    cells,
  };
}
