import type { Project, ProjectFinancialInputFlags } from '../data/types';

export const EMPTY_PROJECT_FINANCIAL_INPUT_FLAGS: Required<ProjectFinancialInputFlags> = {
  contractAmount: false,
  salesVatAmount: false,
  totalRevenueAmount: false,
  supportAmount: false,
};

function normalizeAmountInput(value: string): string {
  return String(value || '').replace(/,/g, '').trim();
}

export function createEmptyProjectFinancialInputFlags(): ProjectFinancialInputFlags {
  return { ...EMPTY_PROJECT_FINANCIAL_INPUT_FLAGS };
}

export function normalizeProjectFinancialInputFlags(
  value: ProjectFinancialInputFlags | null | undefined,
): Required<ProjectFinancialInputFlags> {
  return {
    ...EMPTY_PROJECT_FINANCIAL_INPUT_FLAGS,
    ...(value || {}),
  };
}

export function parseProjectAmountInput(value: string): number {
  const normalized = normalizeAmountInput(value);
  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasExplicitProjectAmountInput(value: string): boolean {
  const normalized = normalizeAmountInput(value);
  if (!normalized) return false;

  return Number.isFinite(Number(normalized));
}

export function hasNonNegativeProjectAmountInput(value: string): boolean {
  return hasExplicitProjectAmountInput(value) && parseProjectAmountInput(value) >= 0;
}

export function formatProjectAmountInput(value: number, hasExplicitValue: boolean): string {
  if (!hasExplicitValue || !Number.isFinite(value)) return '';
  return value.toLocaleString('ko-KR');
}

export function hasStoredProjectAmount(value: unknown, hasExplicitValue?: boolean): boolean {
  if (hasExplicitValue === false) return false;
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatStoredProjectAmount(value: unknown, hasExplicitValue?: boolean): string {
  return hasStoredProjectAmount(value, hasExplicitValue)
    ? `${Number(value).toLocaleString('ko-KR')}원`
    : '-';
}

export function hasStoredProjectContractAmount(project: Partial<Project>): boolean {
  return hasStoredProjectAmount(
    project.contractAmount,
    project.financialInputFlags?.contractAmount,
  );
}
