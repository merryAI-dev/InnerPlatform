import type { Project, ProjectFinancialInputFlags } from '../data/types';

export const EMPTY_PROJECT_FINANCIAL_INPUT_FLAGS: Required<ProjectFinancialInputFlags> = {
  contractAmount: false,
  salesVatAmount: false,
  totalRevenueAmount: false,
  totalActualCost: false,
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

export function normalizeProjectFinancialInputFlagsForAmounts(
  value: ProjectFinancialInputFlags | null | undefined,
  amounts: {
    contractAmount?: number | null;
    salesVatAmount?: number | null;
    totalRevenueAmount?: number | null;
    totalActualCost?: number | null;
    supportAmount?: number | null;
  },
): Required<ProjectFinancialInputFlags> {
  const normalized = normalizeProjectFinancialInputFlags(value);
  return {
    contractAmount: normalized.contractAmount || Number(amounts.contractAmount || 0) > 0,
    salesVatAmount: normalized.salesVatAmount || Number(amounts.salesVatAmount || 0) > 0,
    totalRevenueAmount: normalized.totalRevenueAmount || Number(amounts.totalRevenueAmount || 0) > 0,
    totalActualCost: normalized.totalActualCost || Number(amounts.totalActualCost || 0) > 0,
    supportAmount: normalized.supportAmount || Number(amounts.supportAmount || 0) > 0,
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
