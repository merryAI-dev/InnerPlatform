import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { cashflowWeekCloseSchema, parseWithSchema } from '../schemas.mjs';

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function buildCashflowWeekCloseDocument({
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
    adminClosed: true,
    adminClosedByUid: actorId,
    adminClosedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountCashflowWeekCloseCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/cashflow/weeks/close', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'close cashflow week');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(cashflowWeekCloseSchema, req.body, 'Invalid cashflow week close payload');

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const cashflowWeekId = `${parsed.projectId}-${parsed.yearMonth}-w${parsed.weekNo}`;
      const cashflowWeekRef = db.doc(`orgs/${tenantId}/cashflowWeeks/${cashflowWeekId}`);
      const cashflowWeekSnapshot = await tx.get(cashflowWeekRef);
      const cashflowWeekDocument = buildCashflowWeekCloseDocument({
        current: cashflowWeekSnapshot.exists ? (cashflowWeekSnapshot.data() || {}) : null,
        projectId: parsed.projectId,
        yearMonth: parsed.yearMonth,
        weekNo: parsed.weekNo,
        actorId,
        timestamp,
      });
      tx.set(cashflowWeekRef, cashflowWeekDocument, { merge: true });

      return { cashflowWeek: cashflowWeekDocument };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'cashflow_week',
        entityId: result.cashflowWeek.id,
        action: 'CLOSE',
        actorId,
        actorRole,
        requestId,
        details: `주간 마감 완료: ${parsed.projectId} ${parsed.yearMonth} ${parsed.weekNo}주차`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          version: result.cashflowWeek.version,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        cashflowWeek: result.cashflowWeek,
        summary: {
          projectId: parsed.projectId,
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          closedWeek: true,
        },
      },
    };
  }));
}
