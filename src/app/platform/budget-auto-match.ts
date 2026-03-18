import type { BudgetCodeEntry } from '../data/types';

export interface BudgetMatchResult {
  budgetCategory: string;
  budgetSubCategory: string;
  confidence: 'exact' | 'fuzzy' | 'none';
}

export function matchBudgetCode(
  counterparty: string,
  memo: string,
  cashflowLabel: string,
  codeBook: BudgetCodeEntry[],
): BudgetMatchResult {
  const input = `${counterparty} ${memo} ${cashflowLabel}`.toLowerCase().trim();
  if (!input || codeBook.length === 0) {
    return { budgetCategory: '', budgetSubCategory: '', confidence: 'none' };
  }

  // Exact match: counterparty or memo contains a code name
  for (const entry of codeBook) {
    const codeLower = entry.code.toLowerCase();
    if (input.includes(codeLower)) {
      const subMatch = entry.subCodes.find((sub) => input.includes(sub.toLowerCase()));
      return {
        budgetCategory: entry.code,
        budgetSubCategory: subMatch || entry.subCodes[0] || '',
        confidence: 'exact',
      };
    }
    for (const sub of entry.subCodes) {
      if (input.includes(sub.toLowerCase())) {
        return {
          budgetCategory: entry.code,
          budgetSubCategory: sub,
          confidence: 'exact',
        };
      }
    }
  }

  // Fuzzy: cashflow label maps to common budget categories
  const CASHFLOW_BUDGET_MAP: Record<string, string> = {
    '직접사업비': '직접사업비',
    '간접사업비': '간접사업비',
    '인건비': '인건비',
    '위탁비': '위탁사업비',
    '여비교통비': '여비교통비',
  };

  const mapped = CASHFLOW_BUDGET_MAP[cashflowLabel];
  if (mapped) {
    const entry = codeBook.find((e) => e.code.includes(mapped));
    if (entry) {
      return {
        budgetCategory: entry.code,
        budgetSubCategory: entry.subCodes[0] || '',
        confidence: 'fuzzy',
      };
    }
  }

  return { budgetCategory: '', budgetSubCategory: '', confidence: 'none' };
}
