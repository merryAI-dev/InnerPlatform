function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeAmount(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  return Math.max(0, number);
}

function nonNegativeRate(value) {
  const number = finiteNumber(value);
  if (number == null) return null;
  return Math.max(0, number);
}

export function resolveProjectRevenueFinancials(input = {}) {
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

  return {
    totalRevenueAmount: resolvedAmount,
    profitAmount: resolvedAmount,
    profitRate: contractAmount > 0 ? resolvedAmount / contractAmount : (profitRate ?? 0),
  };
}

export function normalizeProjectRevenueFields(project = {}, preferredSource) {
  return {
    ...project,
    ...resolveProjectRevenueFinancials({
      contractAmount: project.contractAmount,
      totalRevenueAmount: project.totalRevenueAmount,
      profitAmount: project.profitAmount,
      profitRate: project.profitRate,
      preferredSource,
    }),
  };
}
