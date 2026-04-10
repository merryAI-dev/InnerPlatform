import type { BudgetCodeEntry } from '../data/types';
import { normalizeBudgetLabel } from './budget-labels';

export interface BudgetCodeBookValidationResult {
  isValid: boolean;
  errors: string[];
}

function displayCodeLabel(entry: BudgetCodeEntry, index: number): string {
  const trimmed = String(entry.code || '').trim();
  return trimmed || `${index + 1}번째 비목`;
}

export function validateBudgetCodeBookDraft(entries: BudgetCodeEntry[]): BudgetCodeBookValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      isValid: false,
      errors: ['비목을 1개 이상 입력해 주세요.'],
    };
  }

  entries.forEach((entry, index) => {
    const code = normalizeBudgetLabel(entry.code || '');
    const label = displayCodeLabel(entry, index);
    if (!code) {
      errors.push(`${index + 1}번째 비목명을 입력해 주세요.`);
      return;
    }

    const subCodes = Array.isArray(entry.subCodes) ? entry.subCodes : [];
    if (subCodes.length === 0) {
      errors.push(`${label}에 세목을 1개 이상 추가해 주세요.`);
      return;
    }

    if (subCodes.some((subCode) => !normalizeBudgetLabel(subCode || ''))) {
      errors.push(`${label}의 비어 있는 세목명을 입력해 주세요.`);
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
