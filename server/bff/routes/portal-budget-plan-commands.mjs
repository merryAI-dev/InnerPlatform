import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalBudgetPlanSaveSchema } from '../schemas.mjs';

function normalizeBudgetPlanRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      budgetCode: String(row?.budgetCode || '').trim(),
      subCode: String(row?.subCode || '').trim(),
      initialBudget: Number.isFinite(row?.initialBudget) ? Number(row.initialBudget) : 0,
      revisedBudget: Number.isFinite(row?.revisedBudget) ? Number(row.revisedBudget) : 0,
      ...(row?.note ? { note: String(row.note).trim() } : {}),
    }))
    .filter((row) => row.budgetCode && row.subCode);
}

function validateBudgetPlanRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { isValid: false, message: '예산총괄 행을 1개 이상 입력해 주세요.' };
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const budgetCode = String(row.budgetCode || '').trim();
    const subCode = String(row.subCode || '').trim();
    const label = `${index + 1}번째 예산총괄`;
    if (!budgetCode) {
      return { isValid: false, message: `${label}의 비목명을 입력해 주세요.` };
    }
    if (!subCode) {
      return { isValid: false, message: `${label}의 세목명을 입력해 주세요.` };
    }
  }
  return { isValid: true, message: '' };
}

export function mountPortalBudgetPlanCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/budget/plan/save', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save portal budget plan');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(
      portalBudgetPlanSaveSchema,
      req.body,
      'Invalid portal budget plan payload',
    );
    const validation = validateBudgetPlanRows(parsed.rows);
    if (!validation.isValid) {
      throw createHttpError(400, validation.message, 'invalid_budget_plan');
    }
    const sanitizedRows = normalizeBudgetPlanRows(parsed.rows);

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const budgetPlanRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/budget_summary/default`);
      const nextBudgetPlan = stripUndefinedDeep({
        tenantId,
        projectId: parsed.projectId,
        rows: sanitizedRows,
        updatedAt: timestamp,
        updatedBy: actorId,
      });
      tx.set(budgetPlanRef, nextBudgetPlan, { merge: true });

      return {
        budgetPlan: nextBudgetPlan,
        rowCount: sanitizedRows.length,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_budget_plan_save',
        entityId: `${parsed.projectId}:default`,
        action: 'SAVE',
        actorId,
        actorRole,
        requestId,
        details: `예산총괄 저장: ${parsed.projectId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          rowCount: result.rowCount,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        budgetPlanRows: result.budgetPlan.rows,
        summary: {
          projectId: parsed.projectId,
          rowCount: result.rowCount,
        },
      },
    };
  }));
}
