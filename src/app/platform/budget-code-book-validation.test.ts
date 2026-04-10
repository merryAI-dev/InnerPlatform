import { describe, expect, it } from 'vitest';
import { validateBudgetCodeBookDraft } from './budget-code-book-validation';

describe('validateBudgetCodeBookDraft', () => {
  it('rejects budget codes without any sub codes', () => {
    const result = validateBudgetCodeBookDraft([
      { code: '회계감사비용', subCodes: [] },
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('세목을 1개 이상');
  });

  it('rejects blank sub code labels', () => {
    const result = validateBudgetCodeBookDraft([
      { code: '교육운영비', subCodes: [''] },
    ]);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('세목명');
  });

  it('accepts budget codes that have at least one named sub code', () => {
    const result = validateBudgetCodeBookDraft([
      { code: '교육운영비', subCodes: ['강사비'] },
      { code: '출장비', subCodes: ['교통비', '숙박비'] },
    ]);

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
