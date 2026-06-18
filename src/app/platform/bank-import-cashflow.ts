import {
  type BankImportManualFields,
  type CashflowCategory,
  type CashflowSheetLineId,
  type Direction,
  type SettlementEntryKind,
} from '../data/types';
import {
  getCashflowCategoryFromSheetLineId,
  getCashflowSheetLineIdFromCategory,
  listCashflowCategoryOptionsForDirection,
  listCashflowLineOptions,
} from './policies/cashflow-policy';

function resolveDirectionForAmount(signedAmount: number, entryKind?: SettlementEntryKind): Direction {
  if (entryKind === 'DEPOSIT') return 'IN';
  if (entryKind === 'EXPENSE') return 'OUT';
  return signedAmount >= 0 ? 'IN' : 'OUT';
}

export function mapCashflowLineToCategory(
  lineId: CashflowSheetLineId | undefined,
  direction: Direction,
): CashflowCategory {
  return getCashflowCategoryFromSheetLineId(lineId, direction);
}

export function resolveBankImportCashflowOptionsForAmount(signedAmount: number, entryKind?: SettlementEntryKind) {
  return listCashflowLineOptions(resolveDirectionForAmount(signedAmount, entryKind));
}

export function resolveBankImportCashflowCategoryOptionsForAmount(signedAmount: number, entryKind?: SettlementEntryKind) {
  return listCashflowCategoryOptionsForDirection(resolveDirectionForAmount(signedAmount, entryKind));
}

function isCashflowCategory(value: string): value is CashflowCategory {
  return Boolean(
    getCashflowSheetLineIdFromCategory(value as CashflowCategory, 'IN')
    || getCashflowSheetLineIdFromCategory(value as CashflowCategory, 'OUT'),
  );
}

export function resolveBankImportCashflowSelection(
  lineIdOrCategory: CashflowSheetLineId | CashflowCategory,
  signedAmount: number,
  entryKind?: SettlementEntryKind,
): Pick<BankImportManualFields, 'cashflowLineId' | 'cashflowCategory'> {
  const direction = resolveDirectionForAmount(signedAmount, entryKind);
  const category = isCashflowCategory(lineIdOrCategory)
    ? lineIdOrCategory
    : mapCashflowLineToCategory(lineIdOrCategory, direction);
  return {
    cashflowLineId: getCashflowSheetLineIdFromCategory(category, direction),
    cashflowCategory: category,
  };
}

export function resolveBankImportCashflowLineId(
  fields: Pick<BankImportManualFields, 'cashflowLineId' | 'cashflowCategory'> | null | undefined,
  signedAmount: number,
  entryKind?: SettlementEntryKind,
): CashflowSheetLineId | undefined {
  if (fields?.cashflowLineId) return fields.cashflowLineId;
  if (!fields?.cashflowCategory) return undefined;
  return getCashflowSheetLineIdFromCategory(fields.cashflowCategory, resolveDirectionForAmount(signedAmount, entryKind));
}
