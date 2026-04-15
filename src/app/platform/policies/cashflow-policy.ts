import type { CashflowCategory, CashflowSheetLineId, Direction } from '../../data/types';
import cashflowPolicyData from '../../policies/cashflow-policy.json';

type CategoryEntry = {
  category: CashflowCategory;
  label: string;
  defaultLineIds?: Partial<Record<Direction, CashflowSheetLineId>>;
};

type LineEntry = {
  lineId: CashflowSheetLineId;
  label: string;
  direction: Direction;
  defaultCategory: CashflowCategory;
  aliases?: string[];
};

function normalizePolicyLabel(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const CATEGORY_ENTRIES = cashflowPolicyData.categoryEntries as CategoryEntry[];
const LINE_ENTRIES = cashflowPolicyData.lineEntries as LineEntry[];

const CATEGORY_LABELS = Object.fromEntries(
  CATEGORY_ENTRIES.map((entry) => [entry.category, entry.label]),
) as Record<CashflowCategory, string>;

const LINE_LABELS = Object.fromEntries(
  LINE_ENTRIES.map((entry) => [entry.lineId, entry.label]),
) as Record<CashflowSheetLineId, string>;

const CATEGORY_BY_LABEL = new Map<string, CashflowCategory>(
  CATEGORY_ENTRIES.map((entry) => [normalizePolicyLabel(entry.label), entry.category]),
);

const LINE_BY_LABEL = new Map<string, CashflowSheetLineId>();
for (const entry of LINE_ENTRIES) {
  LINE_BY_LABEL.set(normalizePolicyLabel(entry.label), entry.lineId);
  for (const alias of entry.aliases || []) {
    LINE_BY_LABEL.set(normalizePolicyLabel(alias), entry.lineId);
  }
}

const LINE_BY_LABEL_STRIPPED = new Map<string, CashflowSheetLineId>();
for (const [label, lineId] of LINE_BY_LABEL.entries()) {
  LINE_BY_LABEL_STRIPPED.set(label.replace(/\s+/g, ''), lineId);
}

const CATEGORY_ENTRY_BY_ID = new Map<CashflowCategory, CategoryEntry>(
  CATEGORY_ENTRIES.map((entry) => [entry.category, entry]),
);

const LINE_ENTRY_BY_ID = new Map<CashflowSheetLineId, LineEntry>(
  LINE_ENTRIES.map((entry) => [entry.lineId, entry]),
);

export function getCashflowCategoryLabel(category: CashflowCategory): string {
  return CATEGORY_LABELS[category] || category;
}

export function parseCashflowCategoryLabel(raw: string): CashflowCategory | undefined {
  if (!raw) return undefined;
  return CATEGORY_BY_LABEL.get(normalizePolicyLabel(raw));
}

export function getCashflowLineLabel(lineId: CashflowSheetLineId): string {
  return LINE_LABELS[lineId] || lineId;
}

export function parseCashflowLineLabelAlias(raw: string): CashflowSheetLineId | undefined {
  if (!raw) return undefined;
  const normalized = normalizePolicyLabel(raw);
  return LINE_BY_LABEL.get(normalized) || LINE_BY_LABEL_STRIPPED.get(normalized.replace(/\s+/g, ''));
}

export function getCashflowSheetLineIdFromCategory(
  category: CashflowCategory,
  direction: Direction,
): CashflowSheetLineId | undefined {
  return CATEGORY_ENTRY_BY_ID.get(category)?.defaultLineIds?.[direction];
}

export function getCashflowCategoryFromSheetLineId(
  lineId: CashflowSheetLineId | undefined,
  direction: Direction,
): CashflowCategory {
  if (!lineId) return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  return LINE_ENTRY_BY_ID.get(lineId)?.defaultCategory || (direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE');
}

export function getCashflowExportLabel(lineIdOrCategory: CashflowSheetLineId | CashflowCategory | string | undefined): string {
  if (!lineIdOrCategory) return '';
  if (LINE_ENTRY_BY_ID.has(lineIdOrCategory as CashflowSheetLineId)) {
    return getCashflowLineLabel(lineIdOrCategory as CashflowSheetLineId);
  }
  if (CATEGORY_ENTRY_BY_ID.has(lineIdOrCategory as CashflowCategory)) {
    return getCashflowCategoryLabel(lineIdOrCategory as CashflowCategory);
  }
  return String(lineIdOrCategory);
}

export function listCashflowCategoryOptionsForDirection(direction: Direction) {
  return CATEGORY_ENTRIES
    .filter((entry) => Boolean(entry.defaultLineIds?.[direction]))
    .map((entry) => ({ value: entry.category, label: entry.label }));
}

export function listCashflowLineOptions(direction?: Direction) {
  return LINE_ENTRIES
    .filter((entry) => !direction || entry.direction === direction)
    .map((entry) => ({ value: entry.lineId, label: entry.label }));
}

export const CASHFLOW_POLICY_CATEGORY_LABELS = CATEGORY_LABELS;
export const CASHFLOW_POLICY_LINE_LABELS = LINE_LABELS;
export const CASHFLOW_IN_LINE_IDS = LINE_ENTRIES.filter((entry) => entry.direction === 'IN').map((entry) => entry.lineId);
export const CASHFLOW_OUT_LINE_IDS = LINE_ENTRIES.filter((entry) => entry.direction === 'OUT').map((entry) => entry.lineId);
