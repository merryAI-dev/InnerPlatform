import {
  assertActorRoleAllowed,
  createHttpError,
  createMutatingRoute as createMutatingRouteBase,
  ROUTE_ROLES,
  stripUndefinedDeep,
} from '../bff-utils.mjs';
import { parseWithSchema, portalEvidenceRequiredMapSaveSchema } from '../schemas.mjs';

function normalizeEvidenceRequiredMap(map) {
  return Object.fromEntries(
    Object.entries(map || {}).flatMap(([rawKey, rawValue]) => {
      const key = String(rawKey || '').trim();
      if (!key) return [];
      return [[key, String(rawValue ?? '').trim()]];
    }),
  );
}

export function mountPortalEvidenceRequiredMapCommandRoutes(app, {
  db,
  now = () => new Date().toISOString(),
  idempotencyService,
  createMutatingRoute = createMutatingRouteBase,
  auditChainService,
}) {
  app.post('/api/v1/portal/evidence-required-map/save', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'save portal evidence required map');
    const { tenantId, actorId, actorRole, requestId } = req.context;
    const timestamp = now();
    let parsed;
    try {
      parsed = parseWithSchema(
        portalEvidenceRequiredMapSaveSchema,
        req.body,
        'Invalid portal evidence required map payload',
      );
    } catch (error) {
      throw createHttpError(400, error.message || 'Invalid portal evidence required map payload', 'invalid_evidence_required_map');
    }

    const result = await db.runTransaction(async (tx) => {
      const projectRef = db.doc(`orgs/${tenantId}/projects/${parsed.projectId}`);
      const projectSnapshot = await tx.get(projectRef);
      if (!projectSnapshot.exists) {
        throw createHttpError(404, `Project not found: ${parsed.projectId}`, 'project_not_found');
      }

      const evidenceMapRef = db.doc(`orgs/${tenantId}/budgetEvidenceMaps/${parsed.projectId}`);
      const nextEvidenceMap = stripUndefinedDeep({
        tenantId,
        projectId: parsed.projectId,
        map: normalizeEvidenceRequiredMap(parsed.map),
        updatedAt: timestamp,
        updatedBy: actorId,
      });
      tx.set(evidenceMapRef, nextEvidenceMap, { merge: true });

      return {
        evidenceRequiredMap: nextEvidenceMap.map,
        entryCount: Object.keys(nextEvidenceMap.map || {}).length,
      };
    });

    if (auditChainService?.append) {
      await auditChainService.append({
        tenantId,
        entityType: 'portal_evidence_required_map_save',
        entityId: parsed.projectId,
        action: 'SAVE',
        actorId,
        actorRole,
        requestId,
        details: `증빙 필요 지도 저장: ${parsed.projectId}`,
        metadata: {
          source: 'bff',
          projectId: parsed.projectId,
          entryCount: result.entryCount,
        },
        timestamp,
      });
    }

    return {
      status: 200,
      body: {
        evidenceRequiredMap: result.evidenceRequiredMap,
        summary: {
          projectId: parsed.projectId,
          entryCount: result.entryCount,
        },
      },
    };
  }));
}
