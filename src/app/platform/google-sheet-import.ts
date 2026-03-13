import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';

const COLUMN_INDEX_BY_HEADER = new Map(SETTLEMENT_COLUMNS.map((column, index) => [column.csvHeader, index]));

export const GOOGLE_SHEET_PROTECTED_HEADERS = [
  '증빙자료 드라이브',
] as const;

const PROTECTED_HEADER_SET = new Set<string>(GOOGLE_SHEET_PROTECTED_HEADERS);
const PROTECTED_COLUMN_INDEXES = new Set(
  GOOGLE_SHEET_PROTECTED_HEADERS
    .map((header) => COLUMN_INDEX_BY_HEADER.get(header))
    .filter((index): index is number => typeof index === 'number' && index >= 0),
);

function normalizeCell(value: unknown): string {
  return String(value ?? '').normalize('NFC').trim();
}

function normalizeLooseKey(value: unknown): string {
  return normalizeCell(value)
    .toLowerCase()
    .replace(/[\s()[\]{}.,/_-]+/g, '');
}

function normalizeAmountKey(value: unknown): string {
  return normalizeCell(value).replace(/[^\d.-]/g, '');
}

function getColumnIndex(header: string): number {
  return COLUMN_INDEX_BY_HEADER.get(header) ?? -1;
}

function readCell(row: ImportRow, header: string): string {
  const index = getColumnIndex(header);
  if (index < 0) return '';
  return normalizeCell(row.cells[index]);
}

function normalizeImportRow(row: ImportRow, fallbackIndex: number): ImportRow {
  return {
    tempId: row.tempId || `sheet-import-${fallbackIndex + 1}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    cells: SETTLEMENT_COLUMNS.map((_, index) => String(row.cells[index] ?? '').normalize('NFC').trim()),
  };
}

export function buildGoogleSheetImportMatchKey(row: ImportRow): string {
  const date = readCell(row, '거래일시').split(/\s+/)[0].replace(/[./]/g, '-');
  const counterparty = normalizeLooseKey(readCell(row, '지급처'));
  const bankAmount = normalizeAmountKey(readCell(row, '통장에 찍힌 입/출금액'));
  const budgetCategory = normalizeLooseKey(readCell(row, '비목'));
  const budgetSubCategory = normalizeLooseKey(readCell(row, '세목'));

  if (!date || !counterparty) return '';
  return [date, counterparty, bankAmount, budgetCategory, budgetSubCategory].join('|');
}

function sanitizeImportedCells(cells: string[]): string[] {
  return SETTLEMENT_COLUMNS.map((_, index) => {
    if (PROTECTED_COLUMN_INDEXES.has(index)) return '';
    return normalizeCell(cells[index]);
  });
}

function renumberRows(rows: ImportRow[]): ImportRow[] {
  const noIndex = getColumnIndex('No.');
  if (noIndex < 0) return rows;
  return rows.map((row, index) => {
    const cells = [...row.cells];
    cells[noIndex] = String(index + 1);
    return {
      ...row,
      cells,
    };
  });
}

export interface GoogleSheetImportMergeSummary {
  importedCount: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
  protectedHeaders: readonly string[];
}

export interface GoogleSheetImportMergePlan {
  mergedRows: ImportRow[];
  summary: GoogleSheetImportMergeSummary;
}

export function planGoogleSheetImportMerge(
  existingRows: ImportRow[] | null | undefined,
  importedRows: ImportRow[] | null | undefined,
): GoogleSheetImportMergePlan {
  const existing = Array.isArray(existingRows)
    ? existingRows.map((row, index) => normalizeImportRow(row, index))
    : [];
  const imported = Array.isArray(importedRows)
    ? importedRows.map((row, index) => {
      const normalized = normalizeImportRow(row, index);
      return {
        ...normalized,
        cells: sanitizeImportedCells(normalized.cells),
      };
    })
    : [];

  const mergedRows = existing.map((row) => ({
    ...row,
    cells: [...row.cells],
  }));

  const existingSourceBuckets = new Map<string, number[]>();
  const existingKeyBuckets = new Map<string, number[]>();
  existing.forEach((row, index) => {
    const sourceId = normalizeCell(row.sourceTxId);
    const key = buildGoogleSheetImportMatchKey(row);
    if (sourceId) {
      const bucket = existingSourceBuckets.get(sourceId) || [];
      bucket.push(index);
      existingSourceBuckets.set(sourceId, bucket);
    }
    if (key) {
      const bucket = existingKeyBuckets.get(key) || [];
      bucket.push(index);
      existingKeyBuckets.set(key, bucket);
    }
  });

  const usedIndexes = new Set<number>();
  const takeAvailableIndex = (bucket: number[] | undefined): number | null => {
    if (!bucket?.length) return null;
    for (const index of bucket) {
      if (!usedIndexes.has(index)) return index;
    }
    return null;
  };

  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;

  imported.forEach((incoming, importIndex) => {
    const sourceId = normalizeCell(incoming.sourceTxId);
    const key = buildGoogleSheetImportMatchKey(incoming);
    const matchIndex = takeAvailableIndex(sourceId ? existingSourceBuckets.get(sourceId) : undefined)
      ?? takeAvailableIndex(key ? existingKeyBuckets.get(key) : undefined);

    if (matchIndex == null) {
      createCount += 1;
      mergedRows.push({
        ...incoming,
        tempId: incoming.tempId || `sheet-import-new-${importIndex + 1}`,
        cells: [...incoming.cells],
      });
      return;
    }

    usedIndexes.add(matchIndex);
    const current = mergedRows[matchIndex];
    const nextCells = [...current.cells];
    let changed = false;

    incoming.cells.forEach((value, columnIndex) => {
      const header = SETTLEMENT_COLUMNS[columnIndex]?.csvHeader || '';
      if (header === 'No.' || PROTECTED_HEADER_SET.has(header)) return;
      if (!value) return;
      if (nextCells[columnIndex] === value) return;
      nextCells[columnIndex] = value;
      changed = true;
    });

    mergedRows[matchIndex] = {
      ...current,
      ...(current.sourceTxId ? { sourceTxId: current.sourceTxId } : (incoming.sourceTxId ? { sourceTxId: incoming.sourceTxId } : {})),
      cells: nextCells,
    };
    if (changed) {
      updateCount += 1;
    } else {
      unchangedCount += 1;
    }
  });

  return {
    mergedRows: renumberRows(mergedRows),
    summary: {
      importedCount: imported.length,
      createCount,
      updateCount,
      unchangedCount,
      protectedHeaders: GOOGLE_SHEET_PROTECTED_HEADERS,
    },
  };
}
