import type { CashflowSheetLineId } from '../data/types';

export const CASHFLOW_IN_LINES: CashflowSheetLineId[] = [
  'MYSC_PREPAY_IN',
  'SALES_IN',
  'SALES_VAT_IN',
  'TEAM_SUPPORT_IN',
  'BANK_INTEREST_IN',
];

export const CASHFLOW_OUT_LINES: CashflowSheetLineId[] = [
  'DIRECT_COST_OUT',
  'INPUT_VAT_OUT',
  'MYSC_LABOR_OUT',
  'MYSC_PROFIT_OUT',
  'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT',
  'BANK_INTEREST_OUT',
];

export const CASHFLOW_ALL_LINES: CashflowSheetLineId[] = [...CASHFLOW_IN_LINES, ...CASHFLOW_OUT_LINES];

export interface CashflowTotals {
  totalIn: number;
  totalOut: number;
  net: number;
}

export function computeCashflowTotals(
  sheet: Partial<Record<CashflowSheetLineId, number>> | undefined,
): CashflowTotals {
  const src = sheet || {};

  const totalIn = CASHFLOW_IN_LINES.reduce((acc, id) => acc + (Number(src[id]) || 0), 0);
  const totalOut = CASHFLOW_OUT_LINES.reduce((acc, id) => acc + (Number(src[id]) || 0), 0);
  return { totalIn, totalOut, net: totalIn - totalOut };
}

export function hasAnyCashflowKeys(sheet: Partial<Record<CashflowSheetLineId, number>> | undefined): boolean {
  return !!sheet && Object.keys(sheet).length > 0;
}

export function chooseCashflowSheetForNet(input: {
  actual: Partial<Record<CashflowSheetLineId, number>> | undefined;
  projection: Partial<Record<CashflowSheetLineId, number>> | undefined;
}): { source: 'actual' | 'projection'; sheet: Partial<Record<CashflowSheetLineId, number>> } {
  if (hasAnyCashflowKeys(input.actual)) return { source: 'actual', sheet: input.actual || {} };
  return { source: 'projection', sheet: input.projection || {} };
}

