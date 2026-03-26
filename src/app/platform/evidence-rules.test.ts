import { describe, expect, it } from 'vitest';
import { resolveEvidenceRequiredByRules, DEFAULT_EVIDENCE_RULES } from './evidence-rules';

describe('resolveEvidenceRequiredByRules', () => {
  describe('인건비', () => {
    it('금액 무관 — 재직증명서 + 급여명세서', () => {
      expect(resolveEvidenceRequiredByRules('인건비', '', '100,000')).toBe('재직증명서, 급여명세서');
      expect(resolveEvidenceRequiredByRules('인건비', '', '')).toBe('재직증명서, 급여명세서');
    });

    it('세목에 급여 포함 시 적용', () => {
      expect(resolveEvidenceRequiredByRules('인건비', '급여', '500,000')).toBe('재직증명서, 급여명세서');
    });
  });

  describe('직접사업비', () => {
    it('100만원 이상 — 계약서 + 세금계산서', () => {
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '1,000,000')).toBe('계약서, 세금계산서');
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '1,500,000')).toBe('계약서, 세금계산서');
    });

    it('30만원 이상 ~ 100만원 미만 — 세금계산서만', () => {
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '300,000')).toBe('세금계산서');
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '999,999')).toBe('세금계산서');
    });

    it('30만원 미만 — 매칭 없음', () => {
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '299,999')).toBe('');
    });

    it('사업비 키워드도 동일 적용', () => {
      expect(resolveEvidenceRequiredByRules('사업비', '교육비', '1,000,000')).toBe('계약서, 세금계산서');
    });
  });

  describe('출장비', () => {
    it('금액 무관 — 출장신청서 + 영수증', () => {
      expect(resolveEvidenceRequiredByRules('출장비', '', '50,000')).toBe('출장신청서, 영수증');
      expect(resolveEvidenceRequiredByRules('여비', '', '200,000')).toBe('출장신청서, 영수증');
    });
  });

  describe('외주/용역', () => {
    it('50만원 이상 — 계약서 + 세금계산서', () => {
      expect(resolveEvidenceRequiredByRules('외주비', '', '500,000')).toBe('계약서, 세금계산서');
    });

    it('50만원 미만 — 세금계산서만', () => {
      expect(resolveEvidenceRequiredByRules('외주비', '', '400,000')).toBe('세금계산서');
    });

    it('컨설팅 키워드', () => {
      expect(resolveEvidenceRequiredByRules('컨설팅비', '', '1,000,000')).toBe('계약서, 세금계산서');
    });
  });

  describe('운영비', () => {
    it('금액 무관 — 영수증', () => {
      expect(resolveEvidenceRequiredByRules('운영비', '', '10,000')).toBe('영수증');
      expect(resolveEvidenceRequiredByRules('소모품비', '사무용품', '')).toBe('영수증');
    });
  });

  describe('엣지 케이스', () => {
    it('비목이 없으면 빈 문자열', () => {
      expect(resolveEvidenceRequiredByRules('', '', '500,000')).toBe('');
    });

    it('매칭 규칙 없으면 빈 문자열', () => {
      expect(resolveEvidenceRequiredByRules('기타잡비', '', '100,000')).toBe('');
    });

    it('콤마 없는 금액도 파싱', () => {
      expect(resolveEvidenceRequiredByRules('직접사업비', '', '1000000')).toBe('계약서, 세금계산서');
    });
  });

  describe('커스텀 규칙표', () => {
    it('규칙을 비우면 항상 빈 문자열', () => {
      expect(resolveEvidenceRequiredByRules('인건비', '', '500,000', [])).toBe('');
    });
  });
});

describe('DEFAULT_EVIDENCE_RULES', () => {
  it('모든 규칙에 description이 있다', () => {
    DEFAULT_EVIDENCE_RULES.forEach((rule) => {
      expect(rule.description).toBeTruthy();
    });
  });

  it('모든 규칙에 requiredEvidence가 1개 이상', () => {
    DEFAULT_EVIDENCE_RULES.forEach((rule) => {
      expect(rule.requiredEvidence.length).toBeGreaterThan(0);
    });
  });
});
