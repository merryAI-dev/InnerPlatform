import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalExpenseIntakeBulkUpsertSchema } from '../schemas.mjs';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeManualFields(value) {
  const candidate = value && typeof value === 'object' ? value : {};
  const next = {};
  if (Number.isFinite(candidate.expenseAmount)) next.expenseAmount = Number(candidate.expenseAmount);
  if (normalizeString(candidate.budgetCategory)) next.budgetCategory = normalizeString(candidate.budgetCategory);
  if (normalizeString(candidate.budgetSubCategory)) next.budgetSubCategory = normalizeString(candidate.budgetSubCategory);
  if (
    candidate.cashflowLineId === 'MYSC_PREPAY_IN'
    || candidate.cashflowLineId === 'SALES_IN'
    || candidate.cashflowLineId === 'SALES_VAT_IN'
    || candidate.cashflowLineId === 'TEAM_SUPPORT_IN'
    || candidate.cashflowLineId === 'BANK_INTEREST_IN'
    || candidate.cashflowLineId === 'DIRECT_COST_OUT'
    || candidate.cashflowLineId === 'INPUT_VAT_OUT'
    || candidate.cashflowLineId === 'MYSC_LABOR_OUT'
    || candidate.cashflowLineId === 'MYSC_PROFIT_OUT'
    || candidate.cashflowLineId === 'SALES_VAT_OUT'
    || candidate.cashflowLineId === 'TEAM_SUPPORT_OUT'
    || candidate.cashflowLineId === 'BANK_INTEREST_OUT'
  ) {
    next.cashflowLineId = candidate.cashflowLineId;
  }
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

function resolveEvidenceStatus(manualFields) {
  if (normalizeString(manualFields?.evidenceCompletedDesc)) return 'COMPLETE';
  return 'MISSING';
}

function isBankImportManualFieldsComplete(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return Number.isFinite(fields.expenseAmount)
    && Boolean(normalizeString(fields.budgetCategory))
    && Boolean(normalizeString(fields.budgetSubCategory))
    && Boolean(fields.cashflowLineId || fields.cashflowCategory);
}

function resolveProjectionStatus({ matchState, manualFields, evidenceStatus }) {
  if (matchState === 'REVIEW_REQUIRED' || matchState === 'IGNORED') {
    return 'NOT_PROJECTED';
  }
  if (!isBankImportManualFieldsComplete(manualFields)) {
    return 'NOT_PROJECTED';
  }
  return evidenceStatus === 'COMPLETE'
    ? 'PROJECTED'
    : 'PROJECTED_WITH_PENDING_EVIDENCE';
}

function readExistingExpenseIntakeState(current) {
  if (!current || typeof current !== 'object') return null;
  return current;
}

function buildReviewReasons({ current, matchState }) {
  if (matchState === 'REVIEW_REQUIRED') {
    return Array.isArray(current?.reviewReasons) && current.reviewReasons.length > 0
      ? current.reviewReasons.map((reason) => normalizeString(reason)).filter(Boolean)
      : ['manual_review_required'];
  }
  return Array.isArray(current?.reviewReasons)
    ? current.reviewReasons.map((reason) => normalizeString(reason)).filter(Boolean)
    : [];
}

function buildBulkUpsertExpenseIntakeDoc({ orgId, projectId, current, item }) {
  const manualFields = normalizeManualFields(item.manualFields);
  const evidenceStatus = normalizeString(current?.evidenceStatus) || resolveEvidenceStatus(manualFields);
  const projectionStatus = resolveProjectionStatus({
    matchState: item.matchState,
    manualFields,
    evidenceStatus,
  });

  return stripUndefinedDeep({
    tenantId: orgId,
    id: item.id,
    projectId,
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
    projectionStatus,
    evidenceStatus,
    manualFields,
    ...(normalizeString(current?.existingExpenseSheetId) ? { existingExpenseSheetId: normalizeString(current.existingExpenseSheetId) } : {}),
    ...(normalizeString(current?.existingExpenseRowTempId) ? { existingExpenseRowTempId: normalizeString(current.existingExpenseRowTempId) } : {}),
    reviewReasons: buildReviewReasons({ current, matchState: item.matchState }),
    lastUploadBatchId: item.lastUploadBatchId,
    createdAt: normalizeString(current?.createdAt) || item.createdAt,
    updatedAt: item.updatedAt,
    updatedBy: item.updatedBy,
  });
}

export function mountPortalExpenseIntakeBulkUpsertCommandRoutes(app, {
  db,
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
}) {
  app.post('/api/v1/portal/expense-intake/bulk-upsert', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'bulk upsert expense intake items');
    const { tenantId } = req.context;
    const parsed = parseWithSchema(
      portalExpenseIntakeBulkUpsertSchema,
      req.body,
      'Invalid portal expense intake bulk upsert payload',
    );

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      let upsertedCount = 0;
      for (const item of parsed.items) {
        const expenseIntakeRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_intake/${item.id}`);
        const currentSnapshot = await tx.get(expenseIntakeRef);
        const current = readExistingExpenseIntakeState(currentSnapshot.data());
        const expenseIntakeItem = buildBulkUpsertExpenseIntakeDoc({
          orgId: tenantId,
          projectId: parsed.projectId,
          current,
          item,
        });
        tx.set(
          expenseIntakeRef,
          expenseIntakeItem,
          { merge: true },
        );
        upsertedCount += 1;
      }

      return { upsertedCount };
    });

    return {
      status: 200,
      body: {
        summary: {
          projectId: parsed.projectId,
          upsertedCount: result.upsertedCount,
        },
      },
    };
  }));
}
