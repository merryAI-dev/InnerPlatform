import { randomUUID } from 'node:crypto';
import { canActorAssignRole } from '../rbac-policy.mjs';
import { createOutboxEvent, enqueueOutboxEventInTransaction } from '../outbox.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, createHttpError, normalizeRole, encryptAuditEmail,
} from '../bff-utils.mjs';
import { parseWithSchema, memberRoleUpdateSchema } from '../schemas.mjs';

export function mountMemberRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector, rbacPolicy,
}) {
  app.patch('/api/v1/members/:memberId/role', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.memberWrite, 'update member roles');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const { memberId } = req.params;
    const timestamp = now();
    const parsed = parseWithSchema(memberRoleUpdateSchema, req.body, 'Invalid role update payload');
    const targetRole = normalizeRole(parsed.role);

    if (!canActorAssignRole(rbacPolicy, { actorRole, targetRole })) {
      throw createHttpError(403, `Role '${actorRole || 'unknown'}' cannot assign '${targetRole}'`, 'forbidden');
    }

    const memberRef = db.doc(`orgs/${tenantId}/members/${memberId}`);
    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'member.role_changed',
      entityType: 'member',
      entityId: memberId,
      payload: {
        actorRole: actorRole || null,
        targetRole,
        reason: parsed.reason?.trim() || null,
      },
      createdAt: timestamp,
    });

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(memberRef);
      if (!snap.exists) {
        throw createHttpError(404, `Member not found: ${memberId}`, 'not_found');
      }

      const current = snap.data() || {};
      const previousRole = normalizeRole(current.role || 'viewer');

      if (previousRole === 'admin' && targetRole !== 'admin') {
        const adminsSnap = await tx.get(
          db.collection(`orgs/${tenantId}/members`).where('role', '==', 'admin').limit(2),
        );
        if (adminsSnap.size <= 1) {
          throw createHttpError(409, 'Cannot remove the last remaining admin', 'last_admin_lockout');
        }
      }

      tx.set(memberRef, {
        tenantId,
        role: targetRole,
        updatedAt: timestamp,
        updatedBy: actorId,
        roleChangedAt: timestamp,
        roleChangedBy: actorId,
        roleChangeReason: parsed.reason?.trim() || null,
      }, { merge: true });
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);

      return { previousRole };
    });

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'member',
      entityId: memberId,
      action: 'ROLE_CHANGE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `멤버 권한 변경: ${result.previousRole} -> ${targetRole}`,
      metadata: {
        source: 'bff',
        previousRole: result.previousRole,
        nextRole: targetRole,
        reason: parsed.reason?.trim() || null,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        id: memberId,
        previousRole: result.previousRole,
        role: targetRole,
        updatedAt: timestamp,
      },
    };
  }));
}
