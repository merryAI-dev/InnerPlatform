/**
 * 거래처명 정규화 + 오타 탐지 (규칙 기반, AI 불필요)
 *
 * 정규화: "(주)", "주식회사", "유한회사" 등 법인격 접두어/접미어 제거 후 공백·특수문자 통일
 * 오타 탐지: Levenshtein 편집거리 ≤ 2 인 기존 거래처가 있으면 경고 제안
 */

/** 법인격/특수문자 등 노이즈를 제거해 핵심 거래처명만 남긴다 */
export function normalizeCounterpartyName(name: string): string {
  return name
    .trim()
    // 괄호 표기 제거: (주), (유), (재), (사), (의) 등
    .replace(/\(\s*(?:주|유|재|사|의|한)\s*\)/g, '')
    // 앞에 오는 법인격
    .replace(/^(?:주식회사|유한회사|합자회사|합명회사|유한책임회사|사단법인|재단법인|사회적협동조합|협동조합|영농조합법인)\s+/g, '')
    // 뒤에 오는 법인격
    .replace(/\s+(?:주식회사|유한회사|합자회사|합명회사|유한책임회사|사단법인|재단법인|사회적협동조합|협동조합|영농조합법인)$/g, '')
    // 공백 통일
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Levenshtein 편집거리 계산 (두 문자열 사이) */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // 메모리 절약: 두 행만 사용
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insert
        prev[j] + 1,            // delete
        prev[j - 1] + cost,     // replace
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export interface CounterpartySuggestion {
  /** 원본 거래처명 (정규화 전) */
  original: string;
  /** 편집거리 */
  distance: number;
}

/**
 * 입력한 거래처명과 유사한 기존 거래처를 찾아 반환한다.
 *
 * @param input 사용자가 입력한 거래처명
 * @param existingNames 기존 거래처 목록 (중복 포함 가능)
 * @param maxDistance 경고를 띄울 최대 편집거리 (기본 2)
 * @returns 가장 가까운 후보 1개, 없으면 null
 */
export function findSimilarCounterparty(
  input: string,
  existingNames: string[],
  maxDistance = 2,
): CounterpartySuggestion | null {
  const normalizedInput = normalizeCounterpartyName(input);
  if (!normalizedInput) return null;

  let best: CounterpartySuggestion | null = null;

  const seen = new Set<string>();
  for (const name of existingNames) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === input.trim()) continue; // 자기 자신 제외
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);

    const normalizedExisting = normalizeCounterpartyName(trimmed);
    if (!normalizedExisting || normalizedExisting === normalizedInput) continue;

    const dist = levenshtein(normalizedInput, normalizedExisting);
    if (dist <= maxDistance && (best === null || dist < best.distance)) {
      best = { original: trimmed, distance: dist };
    }
  }

  return best;
}
