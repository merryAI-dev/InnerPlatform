import { describe, expect, it } from 'vitest';
import type { ExpenseSet } from './budget-data';
import {
  computeExpenseTotals,
  duplicateExpenseSetAsDraft,
  withExpenseItems,
} from './portal-store.helpers';

const baseSet: ExpenseSet = {
  id: 'es-1',
  projectId: 'p001',
  ledgerId: 'l001',
  title: '1월 집행',
  createdBy: 'u001',
  createdByName: '관리자',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  status: 'DRAFT',
  period: '2026-01',
  items: [
    {
      id: 'ei-1',
      setId: 'es-1',
      date: '2026-01-01',
      budgetCode: '2.1',
      subCode: '2.1.1',
      vendor: 'A사',
      description: '테스트',
      amountNet: 1000,
      vat: 100,
      amountGross: 1100,
      paymentMethod: 'BANK_TRANSFER',
      evidenceStatus: 'MISSING',
      evidenceFiles: [],
      note: '',
    },
  ],
  totalNet: 1000,
  totalVat: 100,
  totalGross: 1100,
};

describe('portal-store helpers', () => {
  it('computes totals from items', () => {
    const totals = computeExpenseTotals([
      { ...baseSet.items[0], id: 'ei-2', amountNet: 2000, vat: 200, amountGross: 2200 },
      { ...baseSet.items[0], id: 'ei-3', amountNet: 500, vat: 50, amountGross: 550 },
    ]);

    expect(totals).toEqual({ totalNet: 2500, totalVat: 250, totalGross: 2750 });
  });

  it('recalculates totals when replacing items', () => {
    const next = withExpenseItems(
      baseSet,
      [
        { ...baseSet.items[0], id: 'ei-2', amountNet: 5000, vat: 500, amountGross: 5500 },
      ],
      '2026-01-02T00:00:00Z',
    );

    expect(next.totalNet).toBe(5000);
    expect(next.totalVat).toBe(500);
    expect(next.totalGross).toBe(5500);
    expect(next.updatedAt).toBe('2026-01-02T00:00:00Z');
  });

  it('duplicates an expense set as draft with new ids', () => {
    const duplicated = duplicateExpenseSetAsDraft(
      baseSet,
      '2026-01-03T00:00:00Z',
      () => 'es-dup-1',
      () => 'ei-dup-1',
    );

    expect(duplicated.id).toBe('es-dup-1');
    expect(duplicated.status).toBe('DRAFT');
    expect(duplicated.items[0].id).toBe('ei-dup-1');
    expect(duplicated.items[0].setId).toBe('es-dup-1');
    expect(duplicated.rejectedReason).toBeUndefined();
  });
});
