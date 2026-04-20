import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalExpenseIntakeDraftSaveSchema } from '../schemas.mjs';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeNumber(value) {
  return Number.isFinite(value) ? Number(value) : 0;
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

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function mergeExpenseIntakeDraft({
  current,
  tenantId,
  projectId,
  intakeId,
  updates,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const mergedManualFields = normalizeManualFields({
    ...(currentValue.manualFields && typeof currentValue.manualFields === 'object' ? currentValue.manualFields : {}),
    ...(updates.manualFields || {}),
  });

  return stripUndefinedDeep({
    ...currentValue,
    tenantId,
    id: intakeId,
    projectId,
    manualFields: mergedManualFields,
    ...(readOptionalText(updates.existingExpenseSheetId) ? { existingExpenseSheetId: readOptionalText(updates.existingExpenseSheetId) } : {}),
    ...(readOptionalText(updates.existingExpenseRowTempId) ? { existingExpenseRowTempId: readOptionalText(updates.existingExpenseRowTempId) } : {}),
    ...(readOptionalText(updates.matchState) ? { matchState: readOptionalText(updates.matchState) } : {}),
    ...(readOptionalText(updates.projectionStatus) ? { projectionStatus: readOptionalText(updates.projectionStatus) } : {}),
    ...(readOptionalText(updates.evidenceStatus) ? { evidenceStatus: readOptionalText(updates.evidenceStatus) } : {}),
    reviewReasons: Array.isArray(updates.reviewReasons)
      ? updates.reviewReasons.map((reason) => readOptionalText(reason)).filter(Boolean)
      : Array.isArray(currentValue.reviewReasons)
        ? currentValue.reviewReasons.map((reason) => readOptionalText(reason)).filter(Boolean)
        : [],
    ...(readOptionalText(updates.lastUploadBatchId) ? { lastUploadBatchId: readOptionalText(updates.lastUploadBatchId) } : {}),
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountPortalExpenseIntakeDraftCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/expense-intake/draft', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save expense intake draft');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalExpenseIntakeDraftSaveSchema,
      req.body,
      'Invalid portal expense intake draft payload',
    );

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const intakeRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/expense_intake/${parsed.intakeId}`);
      const intakeSnapshot = await tx.get(intakeRef);
      if (!intakeSnapshot.exists) {
        throw createHttpError(404, `Expense intake not found: ${parsed.projectId}/${parsed.intakeId}`, 'expense_intake_not_found');
      }

      const current = intakeSnapshot.data() || {};
      const expenseIntakeItem = mergeExpenseIntakeDraft({
        current,
        tenantId,
        projectId: parsed.projectId,
        intakeId: parsed.intakeId,
        updates: parsed.updates,
        actorId,
        timestamp,
      });
      tx.set(intakeRef, expenseIntakeItem, { merge: true });

      return { expenseIntakeItem };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'expense_intake',
        entityId: result.expenseIntakeItem.id,
        action: 'DRAFT_SAVE',
        actorId,
        actorRole,
        requestId,
        details: `비용 증빙 초안 저장: ${parsed.projectId}/${parsed.intakeId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          intakeId: parsed.intakeId,
          updatedManualFieldCount: Object.keys(parsed.updates.manualFields || {}).length,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        expenseIntakeItem: result.expenseIntakeItem,
        summary: {
          updatedManualFieldCount: Object.keys(parsed.updates.manualFields || {}).length,
          version: result.expenseIntakeItem.version,
        },
      },
    };
  }));
}
