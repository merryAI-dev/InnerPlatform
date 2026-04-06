import type { BankImportIntakeItem, BankImportManualFields, BankImportSnapshot } from './types';

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeNumber(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeManualFields(value: unknown): BankImportManualFields {
  const candidate = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  const next: BankImportManualFields = {};
  if (Number.isFinite(candidate.expenseAmount)) next.expenseAmount = Number(candidate.expenseAmount);
  if (normalizeString(candidate.budgetCategory)) next.budgetCategory = normalizeString(candidate.budgetCategory);
  if (normalizeString(candidate.budgetSubCategory)) next.budgetSubCategory = normalizeString(candidate.budgetSubCategory);
  if (
    candidate.cashflowCategory === 'CONTRACT_PAYMENT'
    || candidate.cashflowCategory === 'INTERIM_PAYMENT'
    || candidate.cashflowCategory === 'FINAL_PAYMENT'
    || candidate.cashflowCategory === 'LABOR_COST'
    || candidate.cashflowCategory === 'OUTSOURCING'
    || candidate.cashflowCategory === 'EQUIPMENT'
    || candidate.cashflowCategory === 'TRAVEL'
    || candidate.cashflowCategory === 'SUPPLIES'
    || candidate.cashflowCategory === 'COMMUNICATION'
    || candidate.cashflowCategory === 'RENT'
    || candidate.cashflowCategory === 'UTILITY'
    || candidate.cashflowCategory === 'TAX_PAYMENT'
    || candidate.cashflowCategory === 'VAT_REFUND'
    || candidate.cashflowCategory === 'INSURANCE'
    || candidate.cashflowCategory === 'MISC_INCOME'
    || candidate.cashflowCategory === 'MISC_EXPENSE'
  ) {
    next.cashflowCategory = candidate.cashflowCategory;
  }
  if (normalizeString(candidate.memo)) next.memo = normalizeString(candidate.memo);
  if (typeof candidate.evidenceCompletedDesc === 'string') next.evidenceCompletedDesc = candidate.evidenceCompletedDesc;
  return next;
}

function normalizeBankSnapshot(value: unknown): BankImportSnapshot | null {
  const candidate = (value && typeof value === 'object') ? value as Record<string, unknown> : null;
  if (!candidate) return null;
  return {
    accountNumber: normalizeString(candidate.accountNumber),
    dateTime: normalizeString(candidate.dateTime),
    counterparty: normalizeString(candidate.counterparty),
    memo: normalizeString(candidate.memo),
    signedAmount: normalizeNumber(candidate.signedAmount),
    balanceAfter: normalizeNumber(candidate.balanceAfter),
  };
}

export function serializeBankImportIntakeItemForPersistence(item: BankImportIntakeItem) {
  return {
    id: item.id,
    projectId: item.projectId,
    sourceTxId: item.sourceTxId,
    bankFingerprint: item.bankFingerprint,
    bankSnapshot: {
      accountNumber: item.bankSnapshot.accountNumber,
      dateTime: item.bankSnapshot.dateTime,
      counterparty: item.bankSnapshot.counterparty,
      memo: item.bankSnapshot.memo,
      signedAmount: item.bankSnapshot.signedAmount,
      balanceAfter: item.bankSnapshot.balanceAfter,
    },
    matchState: item.matchState,
    projectionStatus: item.projectionStatus,
    evidenceStatus: item.evidenceStatus,
    manualFields: { ...item.manualFields },
    ...(item.existingExpenseSheetId ? { existingExpenseSheetId: item.existingExpenseSheetId } : {}),
    ...(item.existingExpenseRowTempId ? { existingExpenseRowTempId: item.existingExpenseRowTempId } : {}),
    reviewReasons: [...item.reviewReasons],
    lastUploadBatchId: item.lastUploadBatchId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  };
}

export function normalizeBankImportIntakeItem(value: unknown): BankImportIntakeItem | null {
  const candidate = (value && typeof value === 'object') ? value as Record<string, unknown> : null;
  if (!candidate) return null;
  const bankSnapshot = normalizeBankSnapshot(candidate.bankSnapshot);
  if (!bankSnapshot) return null;
  const matchState = candidate.matchState;
  const projectionStatus = candidate.projectionStatus;
  const evidenceStatus = candidate.evidenceStatus;
  if (
    matchState !== 'AUTO_CONFIRMED'
    && matchState !== 'PENDING_INPUT'
    && matchState !== 'REVIEW_REQUIRED'
    && matchState !== 'IGNORED'
  ) return null;
  if (
    projectionStatus !== 'NOT_PROJECTED'
    && projectionStatus !== 'PROJECTED'
    && projectionStatus !== 'PROJECTED_WITH_PENDING_EVIDENCE'
  ) return null;
  if (
    evidenceStatus !== 'MISSING'
    && evidenceStatus !== 'PARTIAL'
    && evidenceStatus !== 'COMPLETE'
  ) return null;
  return {
    id: normalizeString(candidate.id),
    projectId: normalizeString(candidate.projectId),
    sourceTxId: normalizeString(candidate.sourceTxId),
    bankFingerprint: normalizeString(candidate.bankFingerprint),
    bankSnapshot,
    matchState,
    projectionStatus,
    evidenceStatus,
    manualFields: normalizeManualFields(candidate.manualFields),
    ...(normalizeString(candidate.existingExpenseSheetId) ? { existingExpenseSheetId: normalizeString(candidate.existingExpenseSheetId) } : {}),
    ...(normalizeString(candidate.existingExpenseRowTempId) ? { existingExpenseRowTempId: normalizeString(candidate.existingExpenseRowTempId) } : {}),
    reviewReasons: Array.isArray(candidate.reviewReasons) ? candidate.reviewReasons.map((reason) => normalizeString(reason)).filter(Boolean) : [],
    lastUploadBatchId: normalizeString(candidate.lastUploadBatchId),
    createdAt: normalizeString(candidate.createdAt),
    updatedAt: normalizeString(candidate.updatedAt),
    updatedBy: normalizeString(candidate.updatedBy),
  };
}

export function buildBankImportIntakeDoc(params: {
  orgId: string;
  item: BankImportIntakeItem;
}) {
  return {
    tenantId: params.orgId,
    ...serializeBankImportIntakeItemForPersistence(params.item),
  };
}
