import type { ExpenseItem, ExpenseSet } from './budget-data';

export interface ExpenseTotals {
  totalNet: number;
  totalVat: number;
  totalGross: number;
}

export function computeExpenseTotals(items: ExpenseItem[]): ExpenseTotals {
  const totalNet = items.reduce((sum, item) => sum + item.amountNet, 0);
  const totalVat = items.reduce((sum, item) => sum + item.vat, 0);
  return {
    totalNet,
    totalVat,
    totalGross: totalNet + totalVat,
  };
}

export function withExpenseItems(set: ExpenseSet, items: ExpenseItem[], updatedAt: string): ExpenseSet {
  const totals = computeExpenseTotals(items);
  return {
    ...set,
    items,
    updatedAt,
    ...totals,
  };
}

export function duplicateExpenseSetAsDraft(
  src: ExpenseSet,
  nowIso: string,
  nextSetId: () => string,
  nextItemId: () => string,
): ExpenseSet {
  const duplicatedItems = src.items.map((item) => ({
    ...item,
    id: nextItemId(),
    setId: src.id,
  }));

  const duplicated = withExpenseItems(
    {
      ...src,
      id: nextSetId(),
      title: `${src.title} (복사)`,
      status: 'DRAFT',
      createdAt: nowIso,
      updatedAt: nowIso,
      submittedAt: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      rejectedReason: undefined,
    },
    duplicatedItems,
    nowIso,
  );

  return {
    ...duplicated,
    items: duplicated.items.map((item) => ({
      ...item,
      setId: duplicated.id,
    })),
  };
}
