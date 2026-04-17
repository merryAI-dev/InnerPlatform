import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalSheetSourceApplySchema } from '../schemas.mjs';

export function mountPortalSheetSourceApplyCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/sheet-source/apply', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'apply portal sheet source');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();

    let parsed;
    try {
      parsed = parseWithSchema(
        portalSheetSourceApplySchema,
        req.body,
        'Invalid portal sheet source apply payload',
      );
    } catch (error) {
      throw createHttpError(400, error.message || 'Invalid portal sheet source apply payload', 'invalid_sheet_source_apply');
    }

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const sheetSourceRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}/sheet_sources/${parsed.sourceType}`);
      const nextSheetSource = stripUndefinedDeep({
        tenantId,
        projectId: parsed.projectId,
        sourceType: parsed.sourceType,
        applyTarget: parsed.applyTarget,
        lastAppliedAt: timestamp,
        updatedAt: timestamp,
        updatedBy: actorId,
      });
      tx.set(sheetSourceRef, nextSheetSource, { merge: true });

      return nextSheetSource;
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_sheet_source_apply',
        entityId: `${parsed.projectId}:${parsed.sourceType}`,
        action: 'APPLY',
        actorId,
        actorRole,
        requestId,
        details: `시트 소스 적용: ${parsed.projectId}/${parsed.sourceType}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          sourceType: parsed.sourceType,
          applyTarget: parsed.applyTarget,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        sheetSource: result,
      },
    };
  }));
}
