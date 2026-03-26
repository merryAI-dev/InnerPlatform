import { describe, expect, it } from 'vitest';
import type { Transaction } from '../data/types';
import type { MonthMondayWeek } from './cashflow-weeks';
import {
  aggregateTransactionsToActual,
  computeCashflowTotals,
  hasAnyCashflowKeys,
  mapCategoryToSheetLine,
} from './cashflow-sheet';

// ── helpers ──

function makeTx(
  overrides: Partial<Transaction> &
    Pick<Transaction, 'id' | 'direction' | 'cashflowCategory' | 'dateTime' | 'state'>,
): Transaction {
  return {
    ledgerId: 'L1',
    projectId: 'P1',
    weekCode: '2026-W01',
    method: 'TRANSFER',
    cashflowLabel: '',
    counterparty: '',
    memo: '',
    amounts: {
      bankAmount: 0,
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
    ...overrides,
  };
}

function makeWeek(weekNo: number, start: string, end: string): MonthMondayWeek {
  return { yearMonth: '2026-01', weekNo, weekStart: start, weekEnd: end, label: `26-1-${weekNo}` };
}

// ── computeCashflowTotals ──

describe('computeCashflowTotals', () => {
  it('returns zeros for undefined input', () => {
    expect(computeCashflowTotals(undefined)).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });

  it('returns zeros for empty object', () => {
    expect(computeCashflowTotals({})).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });

  it('sums a single IN line', () => {
    expect(computeCashflowTotals({ SALES_IN: 1_000_000 })).toEqual({
      totalIn: 1_000_000,
      totalOut: 0,
      net: 1_000_000,
    });
  });

  it('sums a single OUT line', () => {
    expect(computeCashflowTotals({ DIRECT_COST_OUT: 500_000 })).toEqual({
      totalIn: 0,
      totalOut: 500_000,
      net: -500_000,
    });
  });

  it('sums all five IN lines', () => {
    const result = computeCashflowTotals({
      MYSC_PREPAY_IN: 2_000_000,
      SALES_IN: 3_000_000,
      SALES_VAT_IN: 300_000,
      TEAM_SUPPORT_IN: 100_000,
      BANK_INTEREST_IN: 50_000,
    });
    expect(result.totalIn).toBe(5_450_000);
    expect(result.totalOut).toBe(0);
    expect(result.net).toBe(5_450_000);
  });

  it('sums all seven OUT lines', () => {
    const result = computeCashflowTotals({
      DIRECT_COST_OUT: 1_000_000,
      INPUT_VAT_OUT: 100_000,
      MYSC_LABOR_OUT: 500_000,
      MYSC_PROFIT_OUT: 200_000,
      SALES_VAT_OUT: 300_000,
      TEAM_SUPPORT_OUT: 50_000,
      BANK_INTEREST_OUT: 10_000,
    });
    expect(result.totalOut).toBe(2_160_000);
    expect(result.totalIn).toBe(0);
    expect(result.net).toBe(-2_160_000);
  });

  it('computes net = totalIn - totalOut for mixed sheet', () => {
    const result = computeCashflowTotals({
      MYSC_PREPAY_IN: 5_000_000,
      TEAM_SUPPORT_IN: 1_000_000,
      DIRECT_COST_OUT: 1_000_000,
      MYSC_LABOR_OUT: 500_000,
    });
    expect(result.totalIn).toBe(6_000_000);
    expect(result.totalOut).toBe(1_500_000);
    expect(result.net).toBe(4_500_000);
  });

  it('handles zero values without affecting totals', () => {
    expect(computeCashflowTotals({ SALES_IN: 0, DIRECT_COST_OUT: 0 })).toEqual({
      totalIn: 0,
      totalOut: 0,
      net: 0,
    });
  });

  it('treats NaN-coercible values as 0', () => {
    const sheet = { SALES_IN: undefined } as unknown as Record<string, number>;
    expect(computeCashflowTotals(sheet)).toEqual({ totalIn: 0, totalOut: 0, net: 0 });
  });
});

// ── hasAnyCashflowKeys ──

describe('hasAnyCashflowKeys', () => {
  it('returns false for undefined', () => {
    expect(hasAnyCashflowKeys(undefined)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(hasAnyCashflowKeys({})).toBe(false);
  });

  it('returns true when object has one key with value 0', () => {
    expect(hasAnyCashflowKeys({ SALES_IN: 0 })).toBe(true);
  });

  it('returns true for multiple keys', () => {
    expect(hasAnyCashflowKeys({ SALES_IN: 100, DIRECT_COST_OUT: 200 })).toBe(true);
  });
});

// ── mapCategoryToSheetLine ──

describe('mapCategoryToSheetLine', () => {
  describe('IN direction', () => {
    it('maps CONTRACT_PAYMENT to SALES_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'CONTRACT_PAYMENT')).toBe('SALES_IN');
    });

    it('maps INTERIM_PAYMENT to SALES_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'INTERIM_PAYMENT')).toBe('SALES_IN');
    });

    it('maps FINAL_PAYMENT to SALES_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'FINAL_PAYMENT')).toBe('SALES_IN');
    });

    it('maps VAT_REFUND to SALES_VAT_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'VAT_REFUND')).toBe('SALES_VAT_IN');
    });

    it('maps MISC_INCOME to BANK_INTEREST_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'MISC_INCOME')).toBe('BANK_INTEREST_IN');
    });

    it('defaults unrecognised IN categories to SALES_IN', () => {
      expect(mapCategoryToSheetLine('IN', 'OUTSOURCING')).toBe('SALES_IN');
      expect(mapCategoryToSheetLine('IN', 'EQUIPMENT')).toBe('SALES_IN');
      expect(mapCategoryToSheetLine('IN', 'TRAVEL')).toBe('SALES_IN');
      expect(mapCategoryToSheetLine('IN', 'SUPPLIES')).toBe('SALES_IN');
      expect(mapCategoryToSheetLine('IN', 'MISC_EXPENSE')).toBe('SALES_IN');
    });
  });

  describe('OUT direction', () => {
    it('maps LABOR_COST to MYSC_LABOR_OUT', () => {
      expect(mapCategoryToSheetLine('OUT', 'LABOR_COST')).toBe('MYSC_LABOR_OUT');
    });

    it('maps TAX_PAYMENT to SALES_VAT_OUT', () => {
      expect(mapCategoryToSheetLine('OUT', 'TAX_PAYMENT')).toBe('SALES_VAT_OUT');
    });

    it('defaults remaining OUT categories to DIRECT_COST_OUT', () => {
      expect(mapCategoryToSheetLine('OUT', 'OUTSOURCING')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'EQUIPMENT')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'TRAVEL')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'SUPPLIES')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'COMMUNICATION')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'RENT')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'UTILITY')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'INSURANCE')).toBe('DIRECT_COST_OUT');
      expect(mapCategoryToSheetLine('OUT', 'MISC_EXPENSE')).toBe('DIRECT_COST_OUT');
    });
  });
});

// ── aggregateTransactionsToActual ──

describe('aggregateTransactionsToActual', () => {
  const weeks: MonthMondayWeek[] = [
    makeWeek(1, '2026-01-01', '2026-01-06'),
    makeWeek(2, '2026-01-07', '2026-01-13'),
    makeWeek(3, '2026-01-14', '2026-01-20'),
  ];

  it('returns empty buckets for empty transactions', () => {
    const result = aggregateTransactionsToActual([], weeks);
    expect(result.size).toBe(3);
    expect(result.get(1)).toEqual({});
    expect(result.get(2)).toEqual({});
    expect(result.get(3)).toEqual({});
  });

  it('excludes DRAFT transactions', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-01-02',
      state: 'DRAFT',
      amounts: { bankAmount: 1000, depositAmount: 1000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(1)).toEqual({});
  });

  it('excludes REJECTED transactions', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'OUT',
      cashflowCategory: 'OUTSOURCING',
      dateTime: '2026-01-08',
      state: 'REJECTED',
      amounts: { bankAmount: 500, depositAmount: 0, expenseAmount: 500, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(2)).toEqual({});
  });

  it('includes SUBMITTED transactions', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-01-02',
      state: 'SUBMITTED',
      amounts: { bankAmount: 1100, depositAmount: 1100, expenseAmount: 0, vatIn: 0, vatOut: 100, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(1)).toEqual({ SALES_IN: 1000, SALES_VAT_IN: 100 });
  });

  it('includes APPROVED transactions', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'MISC_INCOME',
      dateTime: '2026-01-15',
      state: 'APPROVED',
      amounts: { bankAmount: 500, depositAmount: 500, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(3)).toEqual({ BANK_INTEREST_IN: 500 });
  });

  it('splits IN deposit into primary line + SALES_VAT_IN', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'FINAL_PAYMENT',
      dateTime: '2026-01-07',
      state: 'APPROVED',
      amounts: { bankAmount: 11000, depositAmount: 11000, expenseAmount: 0, vatIn: 0, vatOut: 1000, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(2)).toEqual({ SALES_IN: 10000, SALES_VAT_IN: 1000 });
  });

  it('splits OUT expense into primary line + INPUT_VAT_OUT', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'OUT',
      cashflowCategory: 'OUTSOURCING',
      dateTime: '2026-01-14',
      state: 'APPROVED',
      amounts: { bankAmount: 5500, depositAmount: 0, expenseAmount: 5500, vatIn: 500, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(3)).toEqual({ DIRECT_COST_OUT: 5000, INPUT_VAT_OUT: 500 });
  });

  it('accumulates multiple transactions in the same week', () => {
    const tx1 = makeTx({
      id: 'tx1',
      direction: 'OUT',
      cashflowCategory: 'OUTSOURCING',
      dateTime: '2026-01-01',
      state: 'APPROVED',
      amounts: { bankAmount: 2200, depositAmount: 0, expenseAmount: 2200, vatIn: 200, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const tx2 = makeTx({
      id: 'tx2',
      direction: 'OUT',
      cashflowCategory: 'TRAVEL',
      dateTime: '2026-01-03',
      state: 'APPROVED',
      amounts: { bankAmount: 330, depositAmount: 0, expenseAmount: 330, vatIn: 30, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx1, tx2], weeks);
    expect(result.get(1)).toEqual({ DIRECT_COST_OUT: 2300, INPUT_VAT_OUT: 230 });
  });

  it('distributes transactions across different weeks', () => {
    const tx1 = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-01-02',
      state: 'APPROVED',
      amounts: { bankAmount: 1000, depositAmount: 1000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const tx2 = makeTx({
      id: 'tx2',
      direction: 'OUT',
      cashflowCategory: 'LABOR_COST',
      dateTime: '2026-01-15',
      state: 'APPROVED',
      amounts: { bankAmount: 2000, depositAmount: 0, expenseAmount: 2000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx1, tx2], weeks);
    expect(result.get(1)).toEqual({ SALES_IN: 1000 });
    expect(result.get(2)).toEqual({});
    expect(result.get(3)).toEqual({ MYSC_LABOR_OUT: 2000 });
  });

  it('ignores transactions outside all week ranges', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-02-01',
      state: 'APPROVED',
      amounts: { bankAmount: 1000, depositAmount: 1000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(1)).toEqual({});
    expect(result.get(2)).toEqual({});
    expect(result.get(3)).toEqual({});
  });

  it('omits SALES_VAT_IN key when vatOut is 0', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-01-02',
      state: 'APPROVED',
      amounts: { bankAmount: 1000, depositAmount: 1000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(1)).toEqual({ SALES_IN: 1000 });
    expect(result.get(1)!.SALES_VAT_IN).toBeUndefined();
  });

  it('omits INPUT_VAT_OUT key when vatIn is 0', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'OUT',
      cashflowCategory: 'LABOR_COST',
      dateTime: '2026-01-08',
      state: 'APPROVED',
      amounts: { bankAmount: 3000, depositAmount: 0, expenseAmount: 3000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], weeks);
    expect(result.get(2)).toEqual({ MYSC_LABOR_OUT: 3000 });
    expect(result.get(2)!.INPUT_VAT_OUT).toBeUndefined();
  });

  it('returns empty map when monthWeeks is empty', () => {
    const tx = makeTx({
      id: 'tx1',
      direction: 'IN',
      cashflowCategory: 'CONTRACT_PAYMENT',
      dateTime: '2026-01-02',
      state: 'APPROVED',
      amounts: { bankAmount: 1000, depositAmount: 1000, expenseAmount: 0, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 0 },
    });
    const result = aggregateTransactionsToActual([tx], []);
    expect(result.size).toBe(0);
  });
});
