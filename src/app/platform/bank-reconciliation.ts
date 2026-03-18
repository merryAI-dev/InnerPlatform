import type { Transaction } from '../data/types';

// ── Types ──

export interface BankTransaction {
  id: string;
  date: string;        // YYYY-MM-DD
  description: string;
  amount: number;
  direction: 'IN' | 'OUT';
  balance: number;
}

export type BankCsvProfileId = 'GENERIC' | 'HANA' | 'KOOKMIN' | 'SHINHAN';

export interface BankCsvProfileMeta {
  id: BankCsvProfileId;
  label: string;
  quickViewLabel: string;
  actionMenuLabel: string;
  fieldLabels: string[];
}

export type MatchStatus = 'MATCHED' | 'UNMATCHED_BANK' | 'UNMATCHED_SYSTEM';

export interface ReconciliationMatch {
  bankTx: BankTransaction | null;
  systemTx: Transaction | null;
  status: MatchStatus;
  confidence: number; // 0-1
}

const BANK_CSV_PROFILES: Record<BankCsvProfileId, BankCsvProfileMeta> = {
  GENERIC: {
    id: 'GENERIC',
    label: '일반 은행 CSV',
    quickViewLabel: '공통 조회',
    actionMenuLabel: '공통 열',
    fieldLabels: ['거래일자', '적요', '입금/출금액', '잔액'],
  },
  HANA: {
    id: 'HANA',
    label: '하나은행 빠른조회',
    quickViewLabel: '빠른조회',
    actionMenuLabel: '열 메뉴',
    fieldLabels: ['거래일시', '적요', '입금액', '출금액', '거래 후 잔액'],
  },
  KOOKMIN: {
    id: 'KOOKMIN',
    label: '국민은행 빠른조회',
    quickViewLabel: '빠른조회',
    actionMenuLabel: '열 메뉴',
    fieldLabels: ['거래일자', '기재내용', '맡기신금액', '찾으신금액', '잔액'],
  },
  SHINHAN: {
    id: 'SHINHAN',
    label: '신한은행 빠른조회',
    quickViewLabel: '빠른조회',
    actionMenuLabel: '조회 항목',
    fieldLabels: ['거래일', '내용', '입출금액', '거래구분', '잔액'],
  },
};

export function getBankCsvProfileMeta(profileId: BankCsvProfileId | undefined): BankCsvProfileMeta {
  return BANK_CSV_PROFILES[profileId || 'GENERIC'] || BANK_CSV_PROFILES.GENERIC;
}

export function detectBankCsvProfile(matrix: string[][]): BankCsvProfileId {
  if (matrix.length === 0) return 'GENERIC';
  const header = matrix[0].map((cell) => normalizeHeaderToken(cell));
  if (header.some((cell) => cell.includes('거래후잔액')) || header.some((cell) => cell.includes('거래일시'))) {
    return 'HANA';
  }
  if (header.some((cell) => cell.includes('기재내용')) || header.some((cell) => cell.includes('찾으신금액')) || header.some((cell) => cell.includes('맡기신금액'))) {
    return 'KOOKMIN';
  }
  if (header.some((cell) => cell.includes('거래구분')) || header.some((cell) => cell.includes('입출금구분'))) {
    return 'SHINHAN';
  }
  return 'GENERIC';
}

// ── Matching algorithm ──

/**
 * 자동 매칭: 날짜 ±toleranceDays + 금액 일치 + 방향 일치
 */
export function autoMatchBankTransactions(
  bankTxs: BankTransaction[],
  systemTxs: Transaction[],
  toleranceDays = 2,
): ReconciliationMatch[] {
  const results: ReconciliationMatch[] = [];
  const usedBank = new Set<string>();
  const usedSystem = new Set<string>();

  // Sort by date for stable matching
  const sortedBank = [...bankTxs].sort((a, b) => a.date.localeCompare(b.date));
  const sortedSystem = [...systemTxs].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  for (const bt of sortedBank) {
    let bestMatch: Transaction | null = null;
    let bestConfidence = 0;

    for (const st of sortedSystem) {
      if (usedSystem.has(st.id)) continue;
      if (st.direction !== bt.direction) continue;

      // Amount match
      const sysAmount = st.amounts.bankAmount;
      if (sysAmount !== bt.amount) continue;

      // Date proximity
      const bankDate = new Date(bt.date);
      const sysDate = new Date(st.dateTime.slice(0, 10));
      const diffDays = Math.abs(
        (bankDate.getTime() - sysDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diffDays > toleranceDays) continue;

      // Confidence: exact date = 1.0, each day off = -0.15
      const conf = Math.max(0, 1 - diffDays * 0.15);
      if (conf > bestConfidence) {
        bestConfidence = conf;
        bestMatch = st;
      }
    }

    if (bestMatch) {
      usedBank.add(bt.id);
      usedSystem.add(bestMatch.id);
      results.push({
        bankTx: bt,
        systemTx: bestMatch,
        status: 'MATCHED',
        confidence: bestConfidence,
      });
    }
  }

  // Unmatched bank transactions
  for (const bt of sortedBank) {
    if (usedBank.has(bt.id)) continue;
    results.push({
      bankTx: bt,
      systemTx: null,
      status: 'UNMATCHED_BANK',
      confidence: 0,
    });
  }

  // Unmatched system transactions
  for (const st of sortedSystem) {
    if (usedSystem.has(st.id)) continue;
    results.push({
      bankTx: null,
      systemTx: st,
      status: 'UNMATCHED_SYSTEM',
      confidence: 0,
    });
  }

  return results;
}

// ── CSV parsing ──

/**
 * 은행 CSV 파싱 (일반적인 한국 은행 거래내역 형식)
 * 기대 컬럼: 날짜, 적요, 입금액, 출금액, 잔액
 * 또는: 날짜, 적요, 금액, 입출금구분, 잔액
 */
export function parseBankCsv(matrix: string[][]): BankTransaction[] {
  if (matrix.length < 2) return [];

  const header = matrix[0].map((h) => normalizeHeaderToken(h));
  const results: BankTransaction[] = [];

  // Detect format: look for column patterns
  const dateIdx = findHeaderIndex(header, ['날짜', '거래일', '거래일시', '거래일자', 'date']);
  const descIdx = findHeaderIndex(header, ['적요', '내용', '기재내용', 'desc', '메모']);
  const inIdx = findHeaderIndex(header, ['입금액', '입금', '맡기신금액', 'credit']);
  const outIdx = findHeaderIndex(header, ['출금액', '출금', '찾으신금액', 'debit', '지출']);
  const balIdx = findHeaderIndex(header, ['거래후잔액', '잔액', 'balance', '잔고']);
  const amtIdx = findHeaderIndex(header, ['입출금액', '금액', 'amount']);
  const dirIdx = findHeaderIndex(header, ['입출금구분', '거래구분', 'direction']);

  if (dateIdx < 0) return [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row[dateIdx]?.trim()) continue;

    const rawDate = row[dateIdx].trim();
    const date = normalizeDate(rawDate);
    const description = row[descIdx]?.trim() || '';
    const balance = parseAmount(row[balIdx]);

    let amount = 0;
    let direction: 'IN' | 'OUT' = 'OUT';

    if (inIdx >= 0 && outIdx >= 0) {
      // Separate in/out columns
      const inAmt = parseAmount(row[inIdx]);
      const outAmt = parseAmount(row[outIdx]);
      if (inAmt > 0) {
        amount = inAmt;
        direction = 'IN';
      } else {
        amount = outAmt;
        direction = 'OUT';
      }
    } else if (amtIdx >= 0) {
      // Single amount column - infer direction from explicit column first, then from sign.
      const rawAmt = parseAmount(row[amtIdx]);
      if (dirIdx >= 0) {
        const explicitDirection = parseDirection(row[dirIdx]);
        if (explicitDirection) {
          amount = Math.abs(rawAmt);
          direction = explicitDirection;
        } else if (rawAmt >= 0) {
          amount = rawAmt;
          direction = 'IN';
        } else {
          amount = Math.abs(rawAmt);
          direction = 'OUT';
        }
      } else if (rawAmt >= 0) {
        amount = rawAmt;
        direction = 'IN';
      } else {
        amount = Math.abs(rawAmt);
        direction = 'OUT';
      }
    }

    if (amount === 0) continue;

    results.push({
      id: `bank-${i}`,
      date,
      description,
      amount,
      direction,
      balance,
    });
  }

  return results;
}

// ── Helpers ──

function normalizeHeaderToken(raw: string | undefined): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

function findHeaderIndex(headers: string[], keywords: string[]): number {
  return headers.findIndex((header) => keywords.some((keyword) => header.includes(keyword.toLowerCase().replace(/\s+/g, ''))));
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[,\s원₩]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function parseDirection(raw: string | undefined): 'IN' | 'OUT' | null {
  const normalized = String(raw || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('입')) return 'IN';
  if (normalized.includes('출')) return 'OUT';
  if (normalized.includes('credit') || normalized.includes('deposit')) return 'IN';
  if (normalized.includes('debit') || normalized.includes('withdraw')) return 'OUT';
  return null;
}

function normalizeDate(raw: string): string {
  // Handle various date formats: YYYY-MM-DD, YYYY.MM.DD, YYYYMMDD, MM/DD/YYYY
  const cleaned = raw.replace(/[./]/g, '-').trim();
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    return cleaned.slice(0, 10);
  }
  return cleaned;
}
