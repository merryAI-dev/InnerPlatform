import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalWeeklySubmissionSubmitSchema } from '../schemas.mjs';

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function normalizeTransactionIds(values) {
  return (Array.isArray(values) ? values : []).map((value) => readOptionalText(value)).filter(Boolean);
}

function assertUniqueTransactionIds(transactionIds) {
  const seen = new Set();
  const duplicates = [];
  for (const transactionId of transactionIds) {
    if (seen.has(transactionId)) duplicates.push(transactionId);
    seen.add(transactionId);
  }
  if (duplicates.length > 0) {
    throw createHttpError(400, `Duplicate transactionIds are not allowed: ${duplicates.join(', ')}`, 'invalid_request');
  }
}

function buildCashflowWeekDocument({
  current,
  projectId,
  yearMonth,
  weekNo,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    id: `${projectId}-${yearMonth}-w${weekNo}`,
    projectId,
    yearMonth,
    weekNo,
    pmSubmitted: true,
    pmSubmittedByUid: actorId,
    pmSubmittedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

function buildSubmittedTransactionDocument({
  current,
  actorId,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    state: 'SUBMITTED',
    submittedBy: actorId,
    submittedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountPortalWeeklySubmissionCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/weekly-submissions/submit', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'submit portal weekly submission');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalWeeklySubmissionSubmitSchema,
      req.body,
      'Invalid portal weekly submission payload',
    );

    const transactionIds = normalizeTransactionIds(parsed.transactionIds);
    assertUniqueTransactionIds(transactionIds);

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const cashflowWeekId = `${parsed.projectId}-${parsed.yearMonth}-w${parsed.weekNo}`;
      const cashflowWeekRef = db.doc(`orgs/${tenantId}/cashflowWeeks/${cashflowWeekId}`);
      const cashflowWeekSnapshot = await tx.get(cashflowWeekRef);
      const cashflowWeekDocument = buildCashflowWeekDocument({
        current: cashflowWeekSnapshot.exists ? (cashflowWeekSnapshot.data() || {}) : null,
        projectId: parsed.projectId,
        yearMonth: parsed.yearMonth,
        weekNo: parsed.weekNo,
        actorId,
        timestamp,
      });
      tx.set(cashflowWeekRef, cashflowWeekDocument, { merge: true });

      const transactions = [];
      for (const transactionId of transactionIds) {
        const transactionRef = db.doc(`orgs/${tenantId}/transactions/${transactionId}`);
        const transactionSnapshot = await tx.get(transactionRef);
        if (!transactionSnapshot.exists) {
          throw createHttpError(400, `Invalid transactionIds: ${transactionId} was not found`, 'invalid_request');
        }

        const currentTransaction = transactionSnapshot.data() || {};
        if (readOptionalText(currentTransaction.projectId) !== parsed.projectId) {
          throw createHttpError(
            400,
            `Invalid transactionIds: ${transactionId} does not belong to project ${parsed.projectId}`,
            'invalid_request',
          );
        }

        const transactionDocument = buildSubmittedTransactionDocument({
          current: currentTransaction,
          actorId,
          timestamp,
        });
        tx.set(transactionRef, transactionDocument, { merge: true });
        transactions.push(transactionDocument);
      }

      return {
        cashflowWeek: cashflowWeekDocument,
        transactions,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_weekly_submission_submit',
        entityId: `${parsed.projectId}:${parsed.yearMonth}:w${parsed.weekNo}`,
        action: 'SUBMIT',
        actorId,
        actorRole,
        requestId,
        details: `주간 제출 완료: ${parsed.projectId} ${parsed.yearMonth} ${parsed.weekNo}주차`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          transactionCount: result.transactions.length,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        cashflowWeek: result.cashflowWeek,
        transactions: result.transactions,
        summary: {
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          submittedTransactionCount: result.transactions.length,
        },
      },
    };
  }));
}
