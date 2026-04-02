const BUDGET_ENUMERATION_PREFIX_RE = /^\s*\d+(?:(?:[.-]\d+)+|[.)-])\s*/;
const LEADING_BUDGET_PUNCTUATION_RE = /^[.)-]+\s*/;

export function normalizeBudgetLabel(value: unknown): string {
  return String(value ?? '')
    .replace(BUDGET_ENUMERATION_PREFIX_RE, '')
    .replace(LEADING_BUDGET_PUNCTUATION_RE, '')
    .trim();
}

export function buildBudgetLabelKey(budgetCode: unknown, subCode: unknown): string {
  return `${normalizeBudgetLabel(budgetCode)}|${normalizeBudgetLabel(subCode)}`;
}
