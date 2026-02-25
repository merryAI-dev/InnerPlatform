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

export type MatchStatus = 'MATCHED' | 'UNMATCHED_BANK' | 'UNMATCHED_SYSTEM';

export interface ReconciliationMatch {
  bankTx: BankTransaction | null;
  systemTx: Transaction | null;
  status: MatchStatus;
  confidence: number; // 0-1
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

  const header = matrix[0].map((h) => h.trim().toLowerCase());
  const results: BankTransaction[] = [];

  // Detect format: look for column patterns
  const dateIdx = header.findIndex((h) => h.includes('날짜') || h.includes('거래일') || h.includes('date'));
  const descIdx = header.findIndex((h) => h.includes('적요') || h.includes('내용') || h.includes('desc') || h.includes('메모'));
  const inIdx = header.findIndex((h) => h.includes('입금') || h.includes('credit'));
  const outIdx = header.findIndex((h) => h.includes('출금') || h.includes('debit') || h.includes('지출'));
  const balIdx = header.findIndex((h) => h.includes('잔액') || h.includes('balance') || h.includes('잔고'));
  const amtIdx = header.findIndex((h) => h === '금액' || h === 'amount');

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
      // Single amount column - positive = IN, negative = OUT
      const rawAmt = parseAmount(row[amtIdx]);
      if (rawAmt >= 0) {
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

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[,\s원₩]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
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
