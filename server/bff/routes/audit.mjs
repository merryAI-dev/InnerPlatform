import { asyncHandler, assertActorRoleAllowed, ROUTE_ROLES, parseLimit, parseCursor, buildListResponse } from '../bff-utils.mjs';

export function mountAuditRoutes(app, { db, auditChainService }) {
  app.get('/api/v1/audit-logs', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'read audit logs');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);

    let query = db.collection(`orgs/${tenantId}/audit_logs`).orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  app.get('/api/v1/audit-logs/verify', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'verify audit logs');
    const limit = parseLimit(req.query.limit, 2000, 10000);
    const result = await auditChainService.verify({ tenantId, limit });
    res.status(result.ok ? 200 : 409).json(result);
  }));
}
