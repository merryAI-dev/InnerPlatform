import { describe, expect, it } from 'vitest';
import type { Transaction } from '../data/types';
import type { BankTransaction } from './bank-reconciliation';
import { autoMatchBankTransactions, parseBankCsv } from './bank-reconciliation';

// ── helpers ──

function makeBankTx(overrides: Partial<BankTransaction> & Pick<BankTransaction, 'id' | 'date' | 'amount' | 'direction'>): BankTransaction {
  return { description: '', balance: 0, ...overrides };
}

function makeSystemTx(
  overrides: Partial<Transaction> &
    Pick<Transaction, 'id' | 'dateTime' | 'direction'> &
    { bankAmount: number },
): Transaction {
  const { bankAmount, ...rest } = overrides;
  return {
    ledgerId: 'L1',
    projectId: 'P1',
    state: 'APPROVED',
    weekCode: '2026-W01',
    method: 'TRANSFER',
    cashflowCategory: 'CONTRACT_PAYMENT',
    cashflowLabel: '',
    counterparty: '',
    memo: '',
    amounts: {
      bankAmount,
      depositAmount: 0,
      expenseAmount: 0,
      vatIn: 0,
      vatOut: 0,
      vatRefund: 0,
      balanceAfter: 0,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: 'test',
    createdAt: '2026-01-01',
    updatedBy: 'test',
    updatedAt: '2026-01-01',
    ...rest,
  };
}

// ── autoMatchBankTransactions ──

describe('autoMatchBankTransactions', () => {
  it('returns empty results for empty inputs', () => {
    expect(autoMatchBankTransactions([], [])).toEqual([]);
  });

  it('returns UNMATCHED_BANK when only bank txs exist', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-05', amount: 1000, direction: 'IN' })];
    const results = autoMatchBankTransactions(bank, []);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('UNMATCHED_BANK');
    expect(results[0].bankTx?.id).toBe('b1');
    expect(results[0].systemTx).toBeNull();
    expect(results[0].confidence).toBe(0);
  });

  it('returns UNMATCHED_SYSTEM when only system txs exist', () => {
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-05', direction: 'IN', bankAmount: 1000 })];
    const results = autoMatchBankTransactions([], system);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('UNMATCHED_SYSTEM');
    expect(results[0].systemTx?.id).toBe('s1');
    expect(results[0].bankTx).toBeNull();
  });

  it('matches exact date + amount + direction with confidence 1.0', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 5000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'IN', bankAmount: 5000 })];
    const results = autoMatchBankTransactions(bank, system);
    const matched = results.filter((r) => r.status === 'MATCHED');
    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBe(1.0);
    expect(matched[0].bankTx?.id).toBe('b1');
    expect(matched[0].systemTx?.id).toBe('s1');
  });

  it('matches within tolerance window (1 day off -> confidence 0.85)', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 3000, direction: 'OUT' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-11', direction: 'OUT', bankAmount: 3000 })];
    const results = autoMatchBankTransactions(bank, system);
    const matched = results.filter((r) => r.status === 'MATCHED');
    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBeCloseTo(0.85, 5);
  });

  it('matches within tolerance window (2 days off -> confidence 0.70)', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 2000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-12', direction: 'IN', bankAmount: 2000 })];
    const results = autoMatchBankTransactions(bank, system);
    const matched = results.filter((r) => r.status === 'MATCHED');
    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBeCloseTo(0.70, 5);
  });

  it('does not match beyond default tolerance (3 days off)', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-13', direction: 'IN', bankAmount: 1000 })];
    const results = autoMatchBankTransactions(bank, system);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(0);
    expect(results.filter((r) => r.status === 'UNMATCHED_BANK')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'UNMATCHED_SYSTEM')).toHaveLength(1);
  });

  it('respects custom toleranceDays parameter', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-14', direction: 'IN', bankAmount: 1000 })];
    // 4 days difference - default tolerance=2 would miss, tolerance=5 should match
    const results = autoMatchBankTransactions(bank, system, 5);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(1);
  });

  it('does not match when direction differs', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'OUT', bankAmount: 1000 })];
    const results = autoMatchBankTransactions(bank, system);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(0);
  });

  it('does not match when amount differs', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' })];
    const system = [makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'IN', bankAmount: 999 })];
    const results = autoMatchBankTransactions(bank, system);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(0);
  });

  it('handles duplicate amounts — each tx matches at most once', () => {
    const bank = [
      makeBankTx({ id: 'b1', date: '2026-01-10', amount: 5000, direction: 'IN' }),
      makeBankTx({ id: 'b2', date: '2026-01-11', amount: 5000, direction: 'IN' }),
    ];
    const system = [
      makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'IN', bankAmount: 5000 }),
      makeSystemTx({ id: 's2', dateTime: '2026-01-11', direction: 'IN', bankAmount: 5000 }),
    ];
    const results = autoMatchBankTransactions(bank, system);
    const matched = results.filter((r) => r.status === 'MATCHED');
    expect(matched).toHaveLength(2);
    // Each system tx used exactly once
    const usedSystemIds = matched.map((m) => m.systemTx!.id);
    expect(new Set(usedSystemIds).size).toBe(2);
  });

  it('one bank tx cannot match two system txs', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 5000, direction: 'IN' })];
    const system = [
      makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'IN', bankAmount: 5000 }),
      makeSystemTx({ id: 's2', dateTime: '2026-01-10', direction: 'IN', bankAmount: 5000 }),
    ];
    const results = autoMatchBankTransactions(bank, system);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'UNMATCHED_SYSTEM')).toHaveLength(1);
  });

  it('prefers closer date when two system txs have the same amount', () => {
    const bank = [makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' })];
    const system = [
      makeSystemTx({ id: 's-far', dateTime: '2026-01-12', direction: 'IN', bankAmount: 1000 }),
      makeSystemTx({ id: 's-near', dateTime: '2026-01-10', direction: 'IN', bankAmount: 1000 }),
    ];
    const results = autoMatchBankTransactions(bank, system);
    const matched = results.find((r) => r.status === 'MATCHED');
    expect(matched?.systemTx?.id).toBe('s-near');
    expect(matched?.confidence).toBe(1.0);
  });

  it('mixes matched and unmatched in results', () => {
    const bank = [
      makeBankTx({ id: 'b1', date: '2026-01-10', amount: 1000, direction: 'IN' }),
      makeBankTx({ id: 'b2', date: '2026-01-15', amount: 2000, direction: 'OUT' }),
    ];
    const system = [
      makeSystemTx({ id: 's1', dateTime: '2026-01-10', direction: 'IN', bankAmount: 1000 }),
      makeSystemTx({ id: 's3', dateTime: '2026-01-20', direction: 'OUT', bankAmount: 9999 }),
    ];
    const results = autoMatchBankTransactions(bank, system);
    expect(results.filter((r) => r.status === 'MATCHED')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'UNMATCHED_BANK')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'UNMATCHED_SYSTEM')).toHaveLength(1);
  });
});

// ── parseBankCsv ──

describe('parseBankCsv', () => {
  it('returns empty array for empty matrix', () => {
    expect(parseBankCsv([])).toEqual([]);
  });

  it('returns empty array for header-only matrix (no data rows)', () => {
    expect(parseBankCsv([['날짜', '적요', '입금액', '출금액', '잔액']])).toEqual([]);
  });

  it('returns empty array when date column is not found', () => {
    const matrix = [
      ['항목', '적요', '입금액', '출금액', '잔액'],
      ['foo', 'bar', '1000', '', '5000'],
    ];
    expect(parseBankCsv(matrix)).toEqual([]);
  });

  it('parses Korean bank format with separate in/out columns', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '급여입금', '5,000,000', '', '10,000,000'],
      ['2026-01-12', '사무용품', '', '100,000', '9,900,000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(2);

    expect(results[0]).toEqual({
      id: 'bank-1',
      date: '2026-01-10',
      description: '급여입금',
      amount: 5_000_000,
      direction: 'IN',
      balance: 10_000_000,
    });

    expect(results[1]).toEqual({
      id: 'bank-2',
      date: '2026-01-12',
      description: '사무용품',
      amount: 100_000,
      direction: 'OUT',
      balance: 9_900_000,
    });
  });

  it('parses English column headers (date/credit/debit/balance)', () => {
    const matrix = [
      ['date', 'description', 'credit', 'debit', 'balance'],
      ['2026-03-01', 'Payment received', '2000', '', '12000'],
      ['2026-03-02', 'Office rent', '', '500', '11500'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(2);
    expect(results[0].direction).toBe('IN');
    expect(results[0].amount).toBe(2000);
    expect(results[1].direction).toBe('OUT');
    expect(results[1].amount).toBe(500);
  });

  it('parses single-amount column format (positive=IN, negative=OUT)', () => {
    const matrix = [
      ['거래일', '내용', '금액', '잔액'],
      ['2026-01-10', '입금', '500000', '1500000'],
      ['2026-01-11', '출금', '-200000', '1300000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(2);
    expect(results[0].direction).toBe('IN');
    expect(results[0].amount).toBe(500000);
    expect(results[1].direction).toBe('OUT');
    expect(results[1].amount).toBe(200000);
  });

  it('strips currency symbols and whitespace from amounts', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '테스트', '₩1,000,000', '', '₩5,000,000원'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(1_000_000);
    expect(results[0].balance).toBe(5_000_000);
  });

  it('normalizes YYYYMMDD date format', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['20260115', '테스트', '1000', '', '5000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-01-15');
  });

  it('normalizes YYYY.MM.DD date format', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026.02.28', '테스트', '2000', '', '7000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-02-28');
  });

  it('normalizes YYYY/MM/DD date format', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026/03/15', '테스트', '3000', '', '10000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].date).toBe('2026-03-15');
  });

  it('skips rows with empty date cell', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '유효', '1000', '', '5000'],
      ['', '빈날짜', '2000', '', '7000'],
      ['  ', '공백날짜', '3000', '', '10000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('유효');
  });

  it('skips rows with zero amount', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '제로', '0', '0', '5000'],
      ['2026-01-11', '유효', '1000', '', '6000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('유효');
  });

  it('generates sequential bank-N ids', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', 'A', '1000', '', '1000'],
      ['2026-01-11', 'B', '2000', '', '3000'],
      ['2026-01-12', 'C', '', '500', '2500'],
    ];
    const results = parseBankCsv(matrix);
    expect(results.map((r) => r.id)).toEqual(['bank-1', 'bank-2', 'bank-3']);
  });

  it('handles missing description column gracefully', () => {
    const matrix = [
      ['날짜', '입금액', '출금액', '잔액'],
      ['2026-01-10', '1000', '', '5000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('');
  });

  it('handles missing balance column gracefully (defaults to 0)', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액'],
      ['2026-01-10', '테스트', '1000', ''],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].balance).toBe(0);
  });

  it('truncates decimal amounts (Math.trunc behavior)', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '소수', '1234.99', '', '5000.50'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(1234);
    expect(results[0].balance).toBe(5000);
  });

  it('treats non-numeric amount strings as 0 (skips row)', () => {
    const matrix = [
      ['날짜', '적요', '입금액', '출금액', '잔액'],
      ['2026-01-10', '잘못된금액', 'abc', '', '5000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(0);
  });

  it('recognises alternative Korean header names (거래일, 내용, 지출, 잔고)', () => {
    const matrix = [
      ['거래일', '내용', '입금', '지출', '잔고'],
      ['2026-01-10', '대체거래', '3000', '', '8000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].direction).toBe('IN');
    expect(results[0].amount).toBe(3000);
    expect(results[0].balance).toBe(8000);
  });

  it('handles header with extra whitespace', () => {
    const matrix = [
      ['  날짜  ', ' 적요 ', ' 입금액 ', ' 출금액 ', ' 잔액 '],
      ['2026-01-10', '테스트', '1000', '', '5000'],
    ];
    const results = parseBankCsv(matrix);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(1000);
  });
});
