import type { BudgetCodeEntry } from '../data/types';
import { levenshtein } from './counterparty-normalizer';

export interface BudgetMatchResult {
  budgetCategory: string;
  budgetSubCategory: string;
  /** exact = 코드/세목명 직접 포함, fuzzy = 키워드/유사도 기반, none = 미매칭 */
  confidence: 'exact' | 'fuzzy' | 'none';
}

/** 2자 이상 토큰 추출 (한글/영문/숫자) */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * 두 토큰 집합의 교집합 점수 (0~1).
 * exact 일치 또는 한쪽이 다른 쪽을 포함(substring)하는 경우 hit으로 계산.
 * 분모 = min(a, b) — 짧은 쿼리에 유리.
 */
function intersectionScore(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  let hits = 0;
  for (const a of aTokens) {
    const matched = bTokens.some((b) => b === a || b.includes(a) || a.includes(b));
    if (matched) hits++;
  }
  return hits / Math.min(aTokens.length, bTokens.length);
}

/**
 * 단일 토큰 vs. 토큰 리스트 중 최소 편집거리 (정규화 0~1, 낮을수록 유사).
 * 완전 일치 = 0.
 */
function minNormLevenshtein(query: string, targets: string[]): number {
  if (targets.length === 0) return 1;
  return Math.min(
    ...targets.map((t) => {
      const dist = levenshtein(query, t);
      return dist / Math.max(query.length, t.length);
    }),
  );
}

interface CandidateScore {
  entry: BudgetCodeEntry;
  subCode: string;
  score: number;
}

/**
 * 코드북 항목 중 가장 점수가 높은 후보를 반환.
 * 점수 = 키워드 교집합 (0.7 가중) + 편집거리 근접도 (0.3 가중)
 * threshold 이상이어야 반환.
 */
function bestFuzzyMatch(
  inputTokens: string[],
  codeBook: BudgetCodeEntry[],
  threshold = 0.4,
): CandidateScore | null {
  let best: CandidateScore | null = null;

  for (const entry of codeBook) {
    const codeTokens = tokenize(entry.code);

    for (const sub of entry.subCodes.length > 0 ? entry.subCodes : ['']) {
      const subTokens = sub ? tokenize(sub) : [];
      const allTargetTokens = [...codeTokens, ...subTokens];

      const intersection = intersectionScore(inputTokens, allTargetTokens);

      // 입력 토큰 각각에 대해 편집거리 근접도 평균
      const levenScore =
        inputTokens.length > 0
          ? inputTokens.reduce((sum, t) => sum + (1 - minNormLevenshtein(t, allTargetTokens)), 0) /
            inputTokens.length
          : 0;

      const combined = intersection * 0.7 + levenScore * 0.3;

      if (combined >= threshold && (!best || combined > best.score)) {
        best = { entry, subCode: sub, score: combined };
      }
    }
  }

  return best;
}

/**
 * 거래처명 + 메모 + 현금흐름 분류를 코드북에 매칭.
 *
 * 전략 (cascade):
 * 1. Exact: 입력에 코드명/세목명 포함 → confidence: 'exact'
 * 2. Fuzzy: 키워드 교집합 + Levenshtein 유사도 → confidence: 'fuzzy'
 * 3. 없으면 → confidence: 'none'
 */
export function matchBudgetCode(
  counterparty: string,
  memo: string,
  cashflowLabel: string,
  codeBook: BudgetCodeEntry[],
): BudgetMatchResult {
  const input = `${counterparty} ${memo} ${cashflowLabel}`.toLowerCase().trim();
  if (!input || codeBook.length === 0) {
    return { budgetCategory: '', budgetSubCategory: '', confidence: 'none' };
  }

  // ── 1. Exact match ─────────────────────────────────────────────────────────
  for (const entry of codeBook) {
    const codeLower = entry.code.toLowerCase();
    if (input.includes(codeLower)) {
      const subMatch = entry.subCodes.find((sub) => input.includes(sub.toLowerCase()));
      return {
        budgetCategory: entry.code,
        budgetSubCategory: subMatch ?? entry.subCodes[0] ?? '',
        confidence: 'exact',
      };
    }
    for (const sub of entry.subCodes) {
      if (input.includes(sub.toLowerCase())) {
        return {
          budgetCategory: entry.code,
          budgetSubCategory: sub,
          confidence: 'exact',
        };
      }
    }
  }

  // ── 2. Fuzzy: 키워드 교집합 + Levenshtein ──────────────────────────────────
  const inputTokens = tokenize(input);
  const fuzzyMatch = bestFuzzyMatch(inputTokens, codeBook);
  if (fuzzyMatch) {
    return {
      budgetCategory: fuzzyMatch.entry.code,
      budgetSubCategory: fuzzyMatch.subCode,
      confidence: 'fuzzy',
    };
  }

  return { budgetCategory: '', budgetSubCategory: '', confidence: 'none' };
}
