import { describe, expect, it } from 'vitest';
import { matchBudgetCode } from './budget-auto-match';
import type { BudgetCodeEntry } from '../data/types';

const SAMPLE_CODEBOOK: BudgetCodeEntry[] = [
  { code: '직접사업비', subCodes: ['교통비', '재료비', '인쇄비'] },
  { code: '인건비', subCodes: ['급여', '상여금', '퇴직금'] },
  { code: '간접사업비', subCodes: ['사무용품', '통신비', '임차료'] },
];

describe('budget-auto-match', () => {
  it('exact matches counterparty containing code name', () => {
    const result = matchBudgetCode('인건비 지급', '', '', SAMPLE_CODEBOOK);
    expect(result.budgetCategory).toBe('인건비');
    expect(result.confidence).toBe('exact');
  });

  it('exact matches sub-code in memo', () => {
    const result = matchBudgetCode('', '통신비 납부', '', SAMPLE_CODEBOOK);
    expect(result.budgetCategory).toBe('간접사업비');
    expect(result.budgetSubCategory).toBe('통신비');
    expect(result.confidence).toBe('exact');
  });

  it('fuzzy matches via cashflow label when no exact code match', () => {
    // cashflowLabel '위탁비' maps to '위탁사업비' which is NOT in codebook → none
    const result = matchBudgetCode('알수없는업체', '기타', '위탁비', SAMPLE_CODEBOOK);
    expect(result.confidence).toBe('none');
  });

  it('returns none when no match', () => {
    const result = matchBudgetCode('', '', '', SAMPLE_CODEBOOK);
    expect(result.confidence).toBe('none');
  });

  it('returns none with empty codebook', () => {
    const result = matchBudgetCode('인건비', '', '', []);
    expect(result.confidence).toBe('none');
  });
});
