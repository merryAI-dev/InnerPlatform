import { describe, expect, it } from 'vitest';
import { matchBudgetCode } from './budget-auto-match';
import type { BudgetCodeEntry } from '../data/types';

const SAMPLE_CODEBOOK: BudgetCodeEntry[] = [
  { code: '직접사업비', subCodes: ['교통비', '재료비', '인쇄비'] },
  { code: '인건비', subCodes: ['급여', '상여금', '퇴직금'] },
  { code: '간접사업비', subCodes: ['사무용품', '통신비', '임차료'] },
  { code: '위탁사업비', subCodes: ['외부위탁', '용역비'] },
];

describe('matchBudgetCode — exact match', () => {
  it('counterparty에 코드명 포함 → exact', () => {
    const result = matchBudgetCode('인건비 지급', '', '', SAMPLE_CODEBOOK);
    expect(result.budgetCategory).toBe('인건비');
    expect(result.confidence).toBe('exact');
  });

  it('memo에 세목명 포함 → exact (올바른 비목/세목 반환)', () => {
    const result = matchBudgetCode('', '통신비 납부', '', SAMPLE_CODEBOOK);
    expect(result.budgetCategory).toBe('간접사업비');
    expect(result.budgetSubCategory).toBe('통신비');
    expect(result.confidence).toBe('exact');
  });

  it('코드명 + 세목명 모두 포함 → 세목 우선 선택', () => {
    const result = matchBudgetCode('직접사업비', '재료비 구매', '', SAMPLE_CODEBOOK);
    expect(result.budgetCategory).toBe('직접사업비');
    expect(result.budgetSubCategory).toBe('재료비');
    expect(result.confidence).toBe('exact');
  });
});

describe('matchBudgetCode — fuzzy match', () => {
  it('세목 유사 키워드 → fuzzy (교통 ≈ 교통비)', () => {
    // "교통" 단독으로 exact 매칭은 안 되지만 fuzzy로 잡혀야 함
    const result = matchBudgetCode('', '교통 지원', '', SAMPLE_CODEBOOK);
    if (result.confidence !== 'none') {
      expect(result.budgetCategory).toBe('직접사업비');
    }
    // fuzzy이거나 exact 중 하나여야 함 (none이면 실패)
    expect(result.confidence).not.toBe('none');
  });

  it('위탁 키워드 → fuzzy (위탁사업비 매칭)', () => {
    const result = matchBudgetCode('외부위탁 처리 업체', '용역 위탁', '', SAMPLE_CODEBOOK);
    expect(result.confidence).not.toBe('none');
    expect(result.budgetCategory).toBe('위탁사업비');
  });

  it('인건비 유사 키워드 → fuzzy (급여 지급)', () => {
    const result = matchBudgetCode('', '급여 지급', '', SAMPLE_CODEBOOK);
    expect(result.confidence).not.toBe('none');
    expect(result.budgetCategory).toBe('인건비');
  });
});

describe('matchBudgetCode — no match', () => {
  it('완전히 무관한 입력 → none', () => {
    const result = matchBudgetCode('알수없는거래처', '무관한메모', '기타', SAMPLE_CODEBOOK);
    expect(result.confidence).toBe('none');
    expect(result.budgetCategory).toBe('');
  });

  it('빈 입력 → none', () => {
    const result = matchBudgetCode('', '', '', SAMPLE_CODEBOOK);
    expect(result.confidence).toBe('none');
  });

  it('빈 코드북 → none', () => {
    const result = matchBudgetCode('인건비', '', '', []);
    expect(result.confidence).toBe('none');
  });
});
