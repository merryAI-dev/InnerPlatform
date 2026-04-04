import type { ImportRow } from './settlement-csv';

function deserializeDraftRows(rows: unknown): ImportRow[] | null {
  if (!Array.isArray(rows)) return null;
  return rows.map((row, index) => {
    const candidate = row && typeof row === 'object' ? row as Partial<ImportRow> & {
      userEditedCellIndexes?: unknown;
      userEditedCells?: unknown;
    } : {};
    const rawUserEdited = Array.isArray(candidate.userEditedCellIndexes)
      ? candidate.userEditedCellIndexes
      : Array.isArray(candidate.userEditedCells)
        ? candidate.userEditedCells
        : [];
    const userEditedCells = new Set(
      rawUserEdited
        .map((value) => (typeof value === 'number' ? value : Number.parseInt(String(value), 10)))
        .filter((value) => Number.isInteger(value) && value >= 0),
    );
    return {
      tempId: candidate.tempId || `imp-draft-${index}`,
      ...(candidate.sourceTxId ? { sourceTxId: String(candidate.sourceTxId) } : {}),
      ...(candidate.entryKind ? { entryKind: candidate.entryKind } : {}),
      cells: Array.isArray(candidate.cells) ? candidate.cells.map((cell) => String(cell ?? '')) : [],
      ...(candidate.error ? { error: String(candidate.error) } : {}),
      ...(Array.isArray(candidate.reviewHints)
        ? { reviewHints: candidate.reviewHints.map((hint) => String(hint)) }
        : {}),
      ...(Array.isArray(candidate.reviewRequiredCellIndexes)
        ? {
            reviewRequiredCellIndexes: candidate.reviewRequiredCellIndexes
              .map((value) => (typeof value === 'number' ? value : Number.parseInt(String(value), 10)))
              .filter((value) => Number.isInteger(value) && value >= 0),
          }
        : {}),
      ...(candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'confirmed'
        ? { reviewStatus: candidate.reviewStatus }
        : {}),
      ...(candidate.reviewFingerprint ? { reviewFingerprint: String(candidate.reviewFingerprint) } : {}),
      ...(candidate.reviewConfirmedAt ? { reviewConfirmedAt: String(candidate.reviewConfirmedAt) } : {}),
      ...(userEditedCells.size > 0 ? { userEditedCells } : {}),
    } satisfies ImportRow;
  });
}

function serializeDraftRow(row: ImportRow) {
  return {
    tempId: row.tempId,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells) ? row.cells.map((cell) => String(cell ?? '')) : [],
    ...(row.error ? { error: row.error } : {}),
    ...(row.reviewHints && row.reviewHints.length > 0 ? { reviewHints: [...row.reviewHints] } : {}),
    ...(row.reviewRequiredCellIndexes && row.reviewRequiredCellIndexes.length > 0
      ? { reviewRequiredCellIndexes: [...row.reviewRequiredCellIndexes].sort((a, b) => a - b) }
      : {}),
    ...(row.reviewStatus ? { reviewStatus: row.reviewStatus } : {}),
    ...(row.reviewFingerprint ? { reviewFingerprint: row.reviewFingerprint } : {}),
    ...(row.reviewConfirmedAt ? { reviewConfirmedAt: row.reviewConfirmedAt } : {}),
    ...(row.userEditedCells && row.userEditedCells.size > 0
      ? { userEditedCellIndexes: Array.from(row.userEditedCells).sort((a, b) => a - b) }
      : {}),
  };
}

export function readImportDraftCache(cacheKey: string): ImportRow[] | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rows?: ImportRow[] } | null;
    return deserializeDraftRows(parsed?.rows);
  } catch {
    return null;
  }
}

export function writeImportDraftCache(cacheKey: string, rows: ImportRow[]): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(cacheKey, JSON.stringify({ rows: rows.map(serializeDraftRow) }));
  } catch {
    // Ignore browser storage quota errors during local draft caching.
  }
}

export function clearImportDraftCache(cacheKey: string): void {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(cacheKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function serializeImportRows(rows: ImportRow[] | null | undefined): string {
  if (!rows || rows.length === 0) return '';
  try {
    return JSON.stringify(rows.map(serializeDraftRow));
  } catch {
    return String(rows.length);
  }
}
