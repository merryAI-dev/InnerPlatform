import { createOutboxEvent } from '../outbox.mjs';
import { lookupCounterpartyHistory } from '../counterparty-budget-history.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, encryptAuditEmail,
  parseLimit, parseCursor, buildListResponse,
  ensureDocumentExists, upsertVersionedDoc,
  stripServerManagedFields, stripExpectedVersion,
} from '../bff-utils.mjs';
import { parseWithSchema, ledgerUpsertSchema } from '../schemas.mjs';

export function mountLedgerRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector,
}) {
  // ── GET /api/v1/ledgers ──────────────────────────────────────────────────────
  app.get('/api/v1/ledgers', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read ledgers');
    const limit = parseLimit(req.query.limit, 50, 200);
    const cursor = parseCursor(req.query.cursor);
    const projectIdFilter = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';

    let query = db.collection(`orgs/${tenantId}/ledgers`);
    if (projectIdFilter) query = query.where('projectId', '==', projectIdFilter);
    query = query.orderBy('__name__').limit(limit);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    const items = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json(buildListResponse(items, limit));
  }));

  // ── GET /api/v1/budget/suggest ───────────────────────────────────────────────
  app.get('/api/v1/budget/suggest', asyncHandler(async (req, res) => {
    const { tenantId } = req.context;
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'suggest budget code');

    const counterparty = typeof req.query.counterparty === 'string' ? req.query.counterparty.trim() : '';
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';

    if (!counterparty || !projectId) {
      return res.status(200).json({ suggestion: null });
    }

    const suggestion = await lookupCounterpartyHistory(db, tenantId, projectId, counterparty);
    return res.status(200).json({ suggestion });
  }));

  // ── POST /api/v1/ledgers ─────────────────────────────────────────────────────
  app.post('/api/v1/ledgers', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.writeCore, 'write ledgers');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(ledgerUpsertSchema, req.body, 'Invalid ledger payload');
    const expectedVersion = parsed.expectedVersion;

    await ensureDocumentExists(
      db,
      `orgs/${tenantId}/projects/${parsed.projectId}`,
      `Project not found: ${parsed.projectId}`,
    );

    const ledgerPayload = {
      ...stripServerManagedFields(stripExpectedVersion(parsed)),
      id: parsed.id.trim(),
      projectId: parsed.projectId.trim(),
      name: parsed.name.trim(),
    };

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'ledger.upsert',
      entityType: 'ledger',
      entityId: ledgerPayload.id,
      payload: {
        projectId: ledgerPayload.projectId,
        name: ledgerPayload.name,
        expectedVersion: expectedVersion ?? null,
      },
      createdAt: timestamp,
    });

    const result = await upsertVersionedDoc({
      db,
      path: `orgs/${tenantId}/ledgers/${ledgerPayload.id}`,
      payload: ledgerPayload,
      tenantId,
      actorId,
      now: timestamp,
      expectedVersion,
      outboxEvent,
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'ledger',
      entityId: ledgerPayload.id,
      action: result.created ? 'CREATE' : 'UPSERT',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `원장 업데이트: ${ledgerPayload.name}`,
      metadata: {
        source: 'bff',
        version: result.version,
        projectId: ledgerPayload.projectId,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: result.created ? 201 : 200,
      body: {
        id: ledgerPayload.id,
        tenantId,
        version: result.version,
        updatedAt: result.data.updatedAt,
      },
    };
  }));
}
