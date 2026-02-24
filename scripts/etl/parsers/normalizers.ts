/**
 * 날짜/금액/enum 정규화 유틸
 */

// ── 날짜 정규화 ──

const WEEK_CODE_RE = /^(\d{2})-(\d{1,2})-(\d{1,2})$/;           // 26-1-1 → 2026-W01 style
const KR_DATE_RE = /^(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/; // 2026.02.22, 26-01-05
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;                        // 2026-01-01...

export function normalizeDate(raw: unknown): string | null {
  if (raw == null) return null;

  // Already a Date object (ExcelJS returns Date for date cells)
  if (raw instanceof Date) {
    if (!isFinite(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }

  const s = String(raw).trim();
  if (!s) return null;

  // ISO date string
  if (ISO_DATE_RE.test(s)) {
    return s.slice(0, 10);
  }

  // Korean short date: 26.02.22 or 2026.02.22
  const krMatch = s.match(KR_DATE_RE);
  if (krMatch) {
    let year = parseInt(krMatch[1], 10);
    if (year < 100) year += 2000;
    const month = String(krMatch[2]).padStart(2, '0');
    const day = String(krMatch[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * 주차 코드 정규화: "26-1-1" → "2026-01-W1"
 */
export function normalizeWeekCode(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Already an ISO date (e.g., "2026-01-01") → return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  // Week code format: "26-1-1" → "2026-01-W1"
  const m = s.match(WEEK_CODE_RE);
  if (!m) return null;
  const year = 2000 + parseInt(m[1], 10);
  const month = String(m[2]).padStart(2, '0');
  const week = m[3];
  return `${year}-${month}-W${week}`;
}

// ── 금액 정규화 ──

const ERROR_VALUES = new Set(['#REF!', '#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NULL!', '알 수 없음', 'N/A', '-']);

export function normalizeAmount(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return isFinite(raw) ? raw : null;
  }
  const s = String(raw).trim();
  if (!s || ERROR_VALUES.has(s)) return null;
  // Remove commas and whitespace
  const cleaned = s.replace(/[,\s원₩]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

// ── Enum 매핑 ──

export const PAYMENT_METHOD_MAP: Record<string, string> = {
  '계좌이체': 'BANK_TRANSFER',
  '법인카드': 'CARD',
  '현금': 'CASH',
  '수표': 'CHECK',
};

export function normalizePaymentMethod(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Exact match
  if (PAYMENT_METHOD_MAP[s]) return PAYMENT_METHOD_MAP[s];
  // Partial match (e.g., "법인카드(뒷번호1)")
  for (const [kr, en] of Object.entries(PAYMENT_METHOD_MAP)) {
    if (s.includes(kr)) return en;
  }
  return 'OTHER';
}

export const PROJECT_STATUS_MAP: Record<string, string> = {
  '계약전': 'CONTRACT_PENDING',
  '사업진행중': 'IN_PROGRESS',
  '사업종료': 'COMPLETED',
  '종료(잔금대기)': 'COMPLETED_PENDING_PAYMENT',
  '제안서작성중': 'CONTRACT_PENDING',
  '서류제출완료': 'CONTRACT_PENDING',
  '연속사업': 'IN_PROGRESS',
  '26년 계획확인': 'CONTRACT_PENDING',
};

export function normalizeProjectStatus(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (PROJECT_STATUS_MAP[s]) return PROJECT_STATUS_MAP[s];
  // Fuzzy match
  for (const [kr, en] of Object.entries(PROJECT_STATUS_MAP)) {
    if (s.includes(kr)) return en;
  }
  return null;
}

export const PROJECT_TYPE_MAP: Record<string, string> = {
  'AC': 'CONSULTING',
  '컨설팅': 'CONSULTING',
  '교육': 'OTHER',
  '공간': 'SPACE_BIZ',
  '투자': 'IMPACT_INVEST',
  '개발협력': 'DEV_COOPERATION',
  'KOICA': 'DEV_COOPERATION',
};

export function normalizeProjectType(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (PROJECT_TYPE_MAP[s]) return PROJECT_TYPE_MAP[s];
  for (const [kr, en] of Object.entries(PROJECT_TYPE_MAP)) {
    if (s.includes(kr)) return en;
  }
  return 'OTHER';
}

export const SETTLEMENT_TYPE_MAP: Record<string, string> = {
  'Type1': 'TYPE1',
  'Type2': 'TYPE2',
  'Type4': 'TYPE4',
  'Type1. 세금계산서발행+공급가액': 'TYPE1',
  'Type2. 세금계산서발행+공급대가': 'TYPE2',
  'Type4. 세금계산서미발행+공급대가': 'TYPE4',
  '세금계산서발행+공급가액기준': 'TYPE1',
  '세금계산서발행+공급대가기준': 'TYPE2',
};

export function normalizeSettlementType(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return null;
  for (const [pattern, code] of Object.entries(SETTLEMENT_TYPE_MAP)) {
    if (s.includes(pattern.replace(/\s+/g, ''))) return code;
  }
  return null;
}

export const ACCOUNT_TYPE_MAP: Record<string, string> = {
  '전용통장': 'DEDICATED',
  '전용계좌': 'DEDICATED',
  '운영통장': 'OPERATING',
  '운영계좌': 'OPERATING',
};

export function normalizeAccountType(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  for (const [kr, en] of Object.entries(ACCOUNT_TYPE_MAP)) {
    if (s.includes(kr)) return en;
  }
  return 'NONE';
}

/**
 * 빈 문자열/null/undefined → null, 그 외 trim된 string
 */
export function normalizeString(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s || null;
}

/**
 * 퍼센트 정규화: "59.18%", 0.5918, 59.18 → 0.5918
 */
export function normalizePercent(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return raw > 1 ? raw / 100 : raw;
  }
  const s = String(raw).trim().replace('%', '');
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}
