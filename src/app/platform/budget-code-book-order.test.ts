import { describe, expect, it } from 'vitest';
import { moveBudgetSubCode, moveBudgetSubCodeToIndex } from './budget-code-book-order';

describe('budget-code-book-order', () => {
  it('moves a sub code up within the same budget code', () => {
    const original = [
      { code: '운영비', subCodes: ['강사비', '장소비', '다과비'] },
    ];

    const moved = moveBudgetSubCode(original, 0, 1, 'up');

    expect(moved[0].subCodes).toEqual(['장소비', '강사비', '다과비']);
    expect(original[0].subCodes).toEqual(['강사비', '장소비', '다과비']);
  });

  it('moves a sub code down within the same budget code', () => {
    const original = [
      { code: '운영비', subCodes: ['강사비', '장소비', '다과비'] },
    ];

    const moved = moveBudgetSubCode(original, 0, 1, 'down');

    expect(moved[0].subCodes).toEqual(['강사비', '다과비', '장소비']);
  });

  it('returns the original array for out-of-range moves', () => {
    const original = [
      { code: '운영비', subCodes: ['강사비', '장소비'] },
    ];

    expect(moveBudgetSubCode(original, 0, 0, 'up')).toBe(original);
    expect(moveBudgetSubCode(original, 0, 1, 'down')).toBe(original);
  });

  it('moves a sub code to an arbitrary index without mutating the original', () => {
    const original = [
      { code: '운영비', subCodes: ['강사비', '장소비', '다과비', '홍보비'] },
    ];

    const moved = moveBudgetSubCodeToIndex(original, 0, 3, 1);

    expect(moved[0].subCodes).toEqual(['강사비', '홍보비', '장소비', '다과비']);
    expect(original[0].subCodes).toEqual(['강사비', '장소비', '다과비', '홍보비']);
  });

  it('returns the original array when the target index is unchanged', () => {
    const original = [
      { code: '운영비', subCodes: ['강사비', '장소비'] },
    ];

    expect(moveBudgetSubCodeToIndex(original, 0, 1, 1)).toBe(original);
  });
});
