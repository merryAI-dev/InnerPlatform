import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalWeeklySubmissionStatusUpsertSchema } from '../schemas.mjs';

function buildWeeklySubmissionStatusDocument({
  current,
  tenantId,
  projectId,
  yearMonth,
  weekNo,
  actorId,
  timestamp,
  projectionEdited,
  projectionUpdated,
  expenseEdited,
  expenseUpdated,
  expenseSyncState,
  expenseReviewPendingCount,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  const next = {
    ...currentValue,
    id: `${projectId}-${yearMonth}-w${weekNo}`,
    tenantId,
    projectId,
    yearMonth,
    weekNo,
    updatedAt: timestamp,
    updatedByName: actorId,
  };

  if (typeof projectionEdited === 'boolean') {
    next.projectionEdited = projectionEdited;
    next.projectionEditedAt = timestamp;
    next.projectionEditedByName = actorId;
  }
  if (typeof projectionUpdated === 'boolean') {
    next.projectionUpdated = projectionUpdated;
    next.projectionUpdatedAt = timestamp;
    next.projectionUpdatedByName = actorId;
  }
  if (typeof expenseEdited === 'boolean') {
    next.expenseEdited = expenseEdited;
    next.expenseEditedAt = timestamp;
    next.expenseEditedByName = actorId;
  }
  if (typeof expenseUpdated === 'boolean') {
    next.expenseUpdated = expenseUpdated;
    next.expenseUpdatedAt = timestamp;
    next.expenseUpdatedByName = actorId;
  }
  if (
    expenseSyncState === 'pending'
    || expenseSyncState === 'review_required'
    || expenseSyncState === 'synced'
    || expenseSyncState === 'sync_failed'
  ) {
    next.expenseSyncState = expenseSyncState;
    next.expenseSyncUpdatedAt = timestamp;
    next.expenseSyncUpdatedByName = actorId;
  }
  if (typeof expenseReviewPendingCount === 'number' && Number.isFinite(expenseReviewPendingCount)) {
    next.expenseReviewPendingCount = Math.max(0, Math.trunc(expenseReviewPendingCount));
  }

  return stripUndefinedDeep(next);
}

export function mountPortalWeeklySubmissionStatusCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/weekly-submission-status/upsert', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'upsert portal weekly submission status');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalWeeklySubmissionStatusUpsertSchema,
      req.body,
      'Invalid portal weekly submission status payload',
    );

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const id = `${parsed.projectId}-${parsed.yearMonth}-w${parsed.weekNo}`;
      const statusRef = db.doc(`orgs/${tenantId}/weeklySubmissionStatus/${id}`);
      const statusSnapshot = await tx.get(statusRef);
      const statusDocument = buildWeeklySubmissionStatusDocument({
        current: statusSnapshot.exists ? (statusSnapshot.data() || {}) : null,
        tenantId,
        projectId: parsed.projectId,
        yearMonth: parsed.yearMonth,
        weekNo: parsed.weekNo,
        actorId,
        timestamp,
        projectionEdited: parsed.projectionEdited,
        projectionUpdated: parsed.projectionUpdated,
        expenseEdited: parsed.expenseEdited,
        expenseUpdated: parsed.expenseUpdated,
        expenseSyncState: parsed.expenseSyncState,
        expenseReviewPendingCount: parsed.expenseReviewPendingCount,
      });
      tx.set(statusRef, statusDocument, { merge: true });
      return { id, statusDocument };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_weekly_submission_status_upsert',
        entityId: result.id,
        action: 'UPSERT',
        actorId,
        actorRole,
        requestId,
        details: `주간 제출 상태 저장: ${parsed.projectId} ${parsed.yearMonth} ${parsed.weekNo}주차`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          updatedFields: Object.keys(parsed).filter((key) => !['projectId', 'yearMonth', 'weekNo'].includes(key)),
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        weeklySubmissionStatus: result.statusDocument,
        summary: {
          id: result.id,
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
        },
      },
    };
  }));
}
