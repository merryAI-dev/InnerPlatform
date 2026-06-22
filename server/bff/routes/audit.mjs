import { asyncHandler, assertActorRoleAllowed, ROUTE_ROLES, parseLimit, parseCursor, buildListResponse } from '../bff-utils.mjs';

function extractProtectedKeyRef(value) {
  if (typeof value !== 'string') return null;
  const local = value.match(/^enc:v1:([^:]+):/);
  if (local) return local[1];
  const kms = value.match(/^enc:kms:([^:]+):/);
  if (kms) {
    try { return decodeURIComponent(kms[1]); } catch { return kms[1]; }
  }
  return null;
}

export function sanitizeAuditLogItem(raw) {
  const item = { ...(raw || {}) };
  const protectedEmail = typeof item.userEmailEnc === 'string' && item.userEmailEnc.trim();
  if (protectedEmail) {
    item.userEmailProtected = true;
    item.userEmailKeyRef = extractProtectedKeyRef(item.userEmailEnc);
  }
  delete item.userEmailEnc;
  return item;
}

export function mountAuditRoutes(app, { db, auditChainService }) {
  app.get('/api/v1/audit-logs', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.auditRead, 'read audit logs');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);

    let query = db.collection(`orgs/${tenantId}/audit_logs`).orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => sanitizeAuditLogItem({ id: doc.id, ...doc.data() }));
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
