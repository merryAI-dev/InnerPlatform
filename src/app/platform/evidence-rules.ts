/**
 * 필수증빙 자동 판단 — 규칙 기반 (AI fallback 없이 동작)
 *
 * 우선순위:
 * 1. 프로젝트별 evidenceRequiredMap (관리자가 직접 설정한 값)
 * 2. 이 파일의 기본 규칙표 (비목 + 금액대 기반)
 * 3. 규칙 miss → 빈값 (AI fallback은 Phase 2에서)
 *
 * 설계 원칙:
 * - 보조금 정산 공통 규칙 (사업 유형 무관)
 * - 금액 기준은 보수적으로: 놓치는 것보다 더 요구하는 게 안전
 * - 규칙은 추가만 허용, 기존 규칙 삭제 시 영향 범위 검토 필요
 */

export interface EvidenceRule {
  /** 적용할 비목 키워드 (부분 일치, 대소문자 무시) */
  budgetKeywords: string[];
  /** 적용할 최소 금액 (미만이면 규칙 미적용, undefined = 금액 무관) */
  minAmount?: number;
  /** 필수 증빙 목록 */
  requiredEvidence: string[];
  /** 규칙 설명 (디버깅/감사용) */
  description: string;
}

/**
 * 기본 증빙 규칙표
 *
 * 한국 보조금 정산 관행 기반:
 * - 인건비: 재직증명서 + 급여명세서 (금액 무관)
 * - 직접사업비: 30만원 이상 → 세금계산서/영수증, 100만원 이상 → 계약서 추가
 * - 출장비: 출장신청서 + 영수증
 * - 간접비/운영비: 영수증 (소액 포함)
 */
export const DEFAULT_EVIDENCE_RULES: EvidenceRule[] = [
  // 인건비 계열
  {
    budgetKeywords: ['인건비', '급여', '임금', '인력비', '노무비'],
    requiredEvidence: ['재직증명서', '급여명세서'],
    description: '인건비 — 재직증명서 + 급여명세서 필수 (금액 무관)',
  },
  // 직접사업비 고액 (100만원 이상)
  {
    budgetKeywords: ['직접사업비', '사업비', '프로그램비', '행사비', '교육비', '연구비'],
    minAmount: 1_000_000,
    requiredEvidence: ['계약서', '세금계산서'],
    description: '직접사업비 100만원 이상 — 계약서 + 세금계산서',
  },
  // 직접사업비 소액 (30만원 이상 ~ 100만원 미만)
  {
    budgetKeywords: ['직접사업비', '사업비', '프로그램비', '행사비', '교육비', '연구비'],
    minAmount: 300_000,
    requiredEvidence: ['세금계산서'],
    description: '직접사업비 30~100만원 — 세금계산서',
  },
  // 출장비/여비
  {
    budgetKeywords: ['출장비', '여비', '교통비', '여행비'],
    requiredEvidence: ['출장신청서', '영수증'],
    description: '출장비 — 출장신청서 + 영수증',
  },
  // 외주/용역
  {
    budgetKeywords: ['외주', '용역', '위탁', '컨설팅', '자문'],
    minAmount: 500_000,
    requiredEvidence: ['계약서', '세금계산서'],
    description: '외주/용역 50만원 이상 — 계약서 + 세금계산서',
  },
  // 외주/용역 소액
  {
    budgetKeywords: ['외주', '용역', '위탁', '컨설팅', '자문'],
    requiredEvidence: ['세금계산서'],
    description: '외주/용역 소액 — 세금계산서',
  },
  // 운영비/간접비
  {
    budgetKeywords: ['운영비', '간접비', '관리비', '사무비', '소모품'],
    requiredEvidence: ['영수증'],
    description: '운영비/간접비 — 영수증',
  },
];

/** 금액 문자열을 숫자로 변환 (콤마 제거) */
function parseAmountString(value: string | undefined): number {
  if (!value) return 0;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : 0;
}

/** 비목명이 규칙의 키워드와 일치하는지 확인 (부분 일치) */
function matchesBudgetKeywords(budgetCode: string, subCode: string, keywords: string[]): boolean {
  const combined = `${budgetCode} ${subCode}`.toLowerCase();
  return keywords.some((kw) => combined.includes(kw.toLowerCase()));
}

/**
 * 비목 + 금액 기준으로 적용할 규칙을 찾아 필수 증빙 목록을 반환한다.
 *
 * @param budgetCode 비목
 * @param subCode 세목 (없으면 빈 문자열)
 * @param amountStr 금액 문자열 (콤마 포함 가능)
 * @param rules 규칙표 (기본값: DEFAULT_EVIDENCE_RULES)
 * @returns 필수 증빙 쉼표 문자열, 없으면 빈 문자열
 */
export function resolveEvidenceRequiredByRules(
  budgetCode: string,
  subCode: string,
  amountStr: string | undefined,
  rules: EvidenceRule[] = DEFAULT_EVIDENCE_RULES,
): string {
  if (!budgetCode.trim()) return '';

  const amount = parseAmountString(amountStr);

  // 매칭되는 규칙 중 minAmount 조건을 만족하는 것만 필터
  // 동일 키워드에서 금액 조건이 높은 규칙이 더 구체적 → 가장 구체적인 규칙 1개 적용
  const candidates = rules.filter((rule) => {
    if (!matchesBudgetKeywords(budgetCode, subCode, rule.budgetKeywords)) return false;
    if (rule.minAmount !== undefined && amount < rule.minAmount) return false;
    return true;
  });

  if (candidates.length === 0) return '';

  // 금액 조건이 가장 높은(가장 구체적인) 규칙 선택
  const best = candidates.reduce((a, b) => {
    const aMin = a.minAmount ?? 0;
    const bMin = b.minAmount ?? 0;
    return bMin > aMin ? b : a;
  });

  return best.requiredEvidence.join(', ');
}
