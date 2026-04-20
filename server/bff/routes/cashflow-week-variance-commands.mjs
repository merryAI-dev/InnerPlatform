import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  readOptionalText,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { cashflowWeekVarianceFlagSchema, parseWithSchema } from '../schemas.mjs';

function readCurrentVersion(current) {
  return Number.isInteger(current?.version) && current.version > 0 ? current.version : 0;
}

function buildCashflowWeekVarianceDocument({
  current,
  varianceFlag,
  varianceHistory,
  actorId,
  actorName,
  timestamp,
}) {
  const currentValue = current && typeof current === 'object' ? current : {};
  return stripUndefinedDeep({
    ...currentValue,
    varianceFlag: varianceFlag ?? null,
    varianceHistory,
    updatedAt: timestamp,
    updatedByUid: actorId,
    updatedByName: actorName,
    createdAt: readOptionalText(currentValue.createdAt) || timestamp,
    createdBy: readOptionalText(currentValue.createdBy) || actorId,
    version: readCurrentVersion(currentValue) + 1,
  });
}

export function mountCashflowWeekVarianceCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/cashflow/weeks/variance-flag', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'update cashflow variance flag');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(cashflowWeekVarianceFlagSchema, req.body, 'Invalid cashflow variance payload');

    const result = await db.runTransaction(async (tx) => {
      const cashflowWeekRef = db.doc(`orgs/${tenantId}/cashflowWeeks/${parsed.sheetId}`);
      const cashflowWeekSnapshot = await tx.get(cashflowWeekRef);
      if (!cashflowWeekSnapshot.exists) {
        throw createHttpError(404, `Cashflow week not found: ${parsed.sheetId}`, 'cashflow_week_not_found');
      }

      const cashflowWeekDocument = buildCashflowWeekVarianceDocument({
        current: cashflowWeekSnapshot.data() || {},
        varianceFlag: parsed.varianceFlag,
        varianceHistory: parsed.varianceHistory,
        actorId,
        actorName: readOptionalText(req.context?.actorEmail) || actorId,
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
        action: 'FLAG',
        actorId,
        actorRole,
        requestId,
        details: `주간 편차 플래그 갱신: ${parsed.sheetId}`,
        metadata: {
          source: 'bff',
          sheetId: parsed.sheetId,
          hasVarianceFlag: Boolean(parsed.varianceFlag),
          varianceHistoryCount: parsed.varianceHistory.length,
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
          hasVarianceFlag: Boolean(parsed.varianceFlag),
          varianceHistoryCount: parsed.varianceHistory.length,
        },
      },
    };
  }));
}
