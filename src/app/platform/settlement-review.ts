import type { ImportRow } from './settlement-csv';

function normalizeReviewHints(hints: string[] | undefined): string[] {
  return Array.from(new Set((hints || []).map((hint) => hint.trim()).filter(Boolean)));
}

function normalizeReviewIndexes(indexes: number[] | undefined): number[] {
  return Array.from(new Set((indexes || []).filter((value) => Number.isInteger(value) && value >= 0))).sort((left, right) => left - right);
}

export function buildImportRowReviewFingerprint(
  row: Pick<ImportRow, 'cells'>,
  hints: string[] | undefined,
  reviewRequiredCellIndexes: number[] | undefined,
): string {
  const normalizedHints = normalizeReviewHints(hints);
  const normalizedIndexes = normalizeReviewIndexes(reviewRequiredCellIndexes);
  if (normalizedHints.length === 0 || normalizedIndexes.length === 0) return '';
  return JSON.stringify({
    hints: normalizedHints,
    indexes: normalizedIndexes,
    cells: normalizedIndexes.map((index) => String(row.cells[index] || '').trim()),
  });
}

export function hasImportRowReviewRequirement(row: Pick<ImportRow, 'reviewHints'>): boolean {
  return (row.reviewHints?.length || 0) > 0;
}

export function isImportRowReviewConfirmed(row: Pick<ImportRow, 'reviewHints' | 'reviewStatus'>): boolean {
  return hasImportRowReviewRequirement(row) && row.reviewStatus === 'confirmed';
}

export function isImportRowReviewPending(row: Pick<ImportRow, 'reviewHints' | 'reviewStatus'>): boolean {
  return hasImportRowReviewRequirement(row) && row.reviewStatus !== 'confirmed';
}

export function countPendingImportRowReviews(rows: Array<Pick<ImportRow, 'reviewHints' | 'reviewStatus'>>): number {
  return rows.filter((row) => isImportRowReviewPending(row)).length;
}

export function countConfirmedImportRowReviews(rows: Array<Pick<ImportRow, 'reviewHints' | 'reviewStatus'>>): number {
  return rows.filter((row) => isImportRowReviewConfirmed(row)).length;
}
