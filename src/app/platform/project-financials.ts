export type ProjectRevenueFinancialSource = 'totalRevenueAmount' | 'profitAmount' | 'profitRate';

export interface ProjectRevenueFinancialInput {
  contractAmount?: number | null;
  totalRevenueAmount?: number | null;
  profitAmount?: number | null;
  profitRate?: number | null;
  preferredSource?: ProjectRevenueFinancialSource;
}

export interface ProjectRevenueFinancials {
  totalRevenueAmount: number;
  profitAmount: number;
  profitRate: number;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeAmount(value: number | null | undefined): number | null {
  const number = finiteNumber(value);
  if (number == null) return null;
  return Math.max(0, number);
}

function nonNegativeRate(value: number | null | undefined): number | null {
  const number = finiteNumber(value);
  if (number == null) return null;
  return Math.max(0, number);
}

export function resolveProjectRevenueFinancials(input: ProjectRevenueFinancialInput): ProjectRevenueFinancials {
  const contractAmount = nonNegativeAmount(input.contractAmount) ?? 0;
  const totalRevenueAmount = nonNegativeAmount(input.totalRevenueAmount);
  const profitAmount = nonNegativeAmount(input.profitAmount);
  const profitRate = nonNegativeRate(input.profitRate);

  let resolvedAmount = 0;
  if (input.preferredSource === 'profitRate' && profitRate != null && contractAmount > 0) {
    resolvedAmount = Math.round(contractAmount * profitRate);
  } else if (input.preferredSource === 'profitAmount' && profitAmount != null) {
    resolvedAmount = profitAmount;
  } else if (input.preferredSource === 'totalRevenueAmount' && totalRevenueAmount != null) {
    resolvedAmount = totalRevenueAmount;
  } else if (totalRevenueAmount != null) {
    resolvedAmount = totalRevenueAmount;
  } else if (profitAmount != null) {
    resolvedAmount = profitAmount;
  } else if (profitRate != null && contractAmount > 0) {
    resolvedAmount = Math.round(contractAmount * profitRate);
  }

  const resolvedRate = contractAmount > 0
    ? resolvedAmount / contractAmount
    : (profitRate ?? 0);

  return {
    totalRevenueAmount: resolvedAmount,
    profitAmount: resolvedAmount,
    profitRate: resolvedRate,
  };
}

export function formatProfitRatePercentInput(rate: number | null | undefined): string {
  const number = nonNegativeRate(rate);
  return number && number > 0 ? (number * 100).toFixed(2) : '';
}

export function normalizeProjectRevenueFields<
  T extends {
    contractAmount?: number | null;
    totalRevenueAmount?: number | null;
    profitAmount?: number | null;
    profitRate?: number | null;
  },
>(
  project: T,
  preferredSource?: ProjectRevenueFinancialSource,
): T & ProjectRevenueFinancials {
  const revenueFinancials = resolveProjectRevenueFinancials({
    contractAmount: project.contractAmount,
    totalRevenueAmount: project.totalRevenueAmount,
    profitAmount: project.profitAmount,
    profitRate: project.profitRate,
    preferredSource,
  });
  return {
    ...project,
    ...revenueFinancials,
  };
}
