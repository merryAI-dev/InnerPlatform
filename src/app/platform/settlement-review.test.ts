import { describe, expect, it } from 'vitest';
import type { ImportRow } from './settlement-csv';
import {
  buildImportRowReviewFingerprint,
  countConfirmedImportRowReviews,
  countPendingImportRowReviews,
  isImportRowReviewConfirmed,
  isImportRowReviewPending,
} from './settlement-review';

function createRow(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    tempId: overrides.tempId || 'row-1',
    cells: overrides.cells || Array.from({ length: 26 }, () => ''),
    ...overrides,
  };
}

describe('settlement-review', () => {
  it('builds a stable fingerprint from review cells and hints', () => {
    const cells = Array.from({ length: 26 }, () => '');
    cells[13] = '100,000';
    cells[14] = '10,000';
    const row = createRow({ cells });

    const left = buildImportRowReviewFingerprint(row, ['매입부가세 후보값입니다.'], [14]);
    const right = buildImportRowReviewFingerprint(row, ['매입부가세 후보값입니다.'], [14]);

    expect(left).toBe(right);
    expect(left).toContain('10,000');
  });

  it('distinguishes pending and confirmed review rows', () => {
    const rows: ImportRow[] = [
      createRow({ tempId: 'pending', reviewHints: ['검토'], reviewStatus: 'pending' }),
      createRow({ tempId: 'confirmed', reviewHints: ['검토'], reviewStatus: 'confirmed' }),
      createRow({ tempId: 'none' }),
    ];

    expect(isImportRowReviewPending(rows[0])).toBe(true);
    expect(isImportRowReviewConfirmed(rows[1])).toBe(true);
    expect(countPendingImportRowReviews(rows)).toBe(1);
    expect(countConfirmedImportRowReviews(rows)).toBe(1);
  });
});
