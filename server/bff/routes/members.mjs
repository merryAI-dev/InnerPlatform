import { randomUUID } from 'node:crypto';
import { canActorAssignRole } from '../rbac-policy.mjs';
import { createOutboxEvent, enqueueOutboxEventInTransaction } from '../outbox.mjs';
import {
  asyncHandler, createMutatingRoute, assertActorRoleAllowed,
  ROUTE_ROLES, createHttpError, normalizeRole, encryptAuditEmail,
} from '../bff-utils.mjs';
import { parseWithSchema, memberDeepSyncSchema, memberRoleUpdateSchema } from '../schemas.mjs';
import {
  buildDeepSyncPlan,
  mergeAuthGovernanceDirectory,
  parseBootstrapAdminEmails,
} from '../auth-governance.mjs';

async function listAllAuthUsers(authAdminService) {
  if (!authAdminService || typeof authAdminService.listUsers !== 'function') {
    throw createHttpError(503, 'Firebase auth admin service is not configured', 'auth_admin_unavailable');
  }

  const users = [];
  let pageToken;
  do {
    const page = await authAdminService.listUsers(1000, pageToken);
    for (const user of page.users || []) {
      users.push({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        disabled: Boolean(user.disabled),
        customClaims: user.customClaims || {},
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function listMemberDocs(db, tenantId) {
  const snap = await db.collection(`orgs/${tenantId}/members`).get();
  return snap.docs.map((doc) => ({
    docId: doc.id,
    data: doc.data() || {},
  }));
}

function buildGovernanceSummary(entries) {
  return {
    total: entries.length,
    needsDeepSync: entries.filter((entry) => entry.needsDeepSync).length,
    missingAuth: entries.filter((entry) => entry.driftFlags.includes('missing_auth')).length,
    missingCanonicalMember: entries.filter((entry) => entry.driftFlags.includes('missing_canonical_member')).length,
    duplicateMemberDocs: entries.filter((entry) => entry.driftFlags.includes('duplicate_member_docs')).length,
    bootstrapCandidates: entries.filter((entry) => entry.bootstrapAdmin).length,
  };
}

export function mountMemberRoutes(app, {
  db, now, idempotencyService, auditChainService, piiProtector, rbacPolicy, authAdminService,
}) {
  app.get('/api/v1/admin/auth-governance/users', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.memberWrite, 'read auth governance users');
    const { tenantId } = req.context;
    const [authUsers, memberDocs] = await Promise.all([
      listAllAuthUsers(authAdminService),
      listMemberDocs(db, tenantId),
    ]);
    const items = mergeAuthGovernanceDirectory({
      authUsers,
      memberDocs,
      bootstrapAdminEmails: parseBootstrapAdminEmails(process.env),
    });
    res.status(200).json({
      items,
      summary: buildGovernanceSummary(items),
    });
  }));

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

  app.post('/api/v1/admin/auth-governance/users/:identityKey/deep-sync', createMutatingRoute(idempotencyService, async (req) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.memberWrite, 'deep sync auth governance user');
    const { tenantId, actorId, actorRole, actorEmail, requestId } = req.context;
    const timestamp = now();
    const parsed = parseWithSchema(memberDeepSyncSchema, req.body, 'Invalid auth governance sync payload');
    const targetRole = normalizeRole(parsed.role);

    if (!canActorAssignRole(rbacPolicy, { actorRole, targetRole })) {
      throw createHttpError(403, `Role '${actorRole || 'unknown'}' cannot assign '${targetRole}'`, 'forbidden');
    }

    const identityKey = decodeURIComponent(req.params.identityKey || '').trim().toLowerCase();
    const [authUsers, memberDocs] = await Promise.all([
      listAllAuthUsers(authAdminService),
      listMemberDocs(db, tenantId),
    ]);
    const directory = mergeAuthGovernanceDirectory({
      authUsers,
      memberDocs,
      bootstrapAdminEmails: parseBootstrapAdminEmails(process.env),
    });
    const entry = directory.find((item) => item.identityKey === identityKey);
    if (!entry) {
      throw createHttpError(404, `Auth governance user not found: ${identityKey}`, 'not_found');
    }

    if (entry.effectiveRole === 'admin' && targetRole !== 'admin') {
      const adminsSnap = await db.collection(`orgs/${tenantId}/members`).where('role', '==', 'admin').limit(2).get();
      if (adminsSnap.size <= 1) {
        throw createHttpError(409, 'Cannot remove the last remaining admin', 'last_admin_lockout');
      }
    }

    const plan = buildDeepSyncPlan({
      entry,
      targetRole,
      tenantId,
      actorId,
      timestamp,
      reason: parsed.reason?.trim() || null,
    });

    const outboxEvent = createOutboxEvent({
      tenantId,
      requestId,
      eventType: 'member.role_changed',
      entityType: 'member',
      entityId: plan.canonicalDocId,
      payload: {
        actorRole: actorRole || null,
        targetRole,
        reason: parsed.reason?.trim() || null,
        source: 'auth_governance_deep_sync',
      },
      createdAt: timestamp,
    });

    await db.runTransaction(async (tx) => {
      tx.set(db.doc(`orgs/${tenantId}/members/${plan.canonicalDocId}`), plan.canonicalPatch, { merge: true });
      for (const legacy of plan.legacyPatches) {
        tx.set(db.doc(`orgs/${tenantId}/members/${legacy.docId}`), legacy.patch, { merge: true });
      }
      enqueueOutboxEventInTransaction(tx, db, outboxEvent);
    });

    if (plan.claims && entry.authUid) {
      await authAdminService.setCustomUserClaims(entry.authUid, plan.claims);
    }

    const actorEmailEnc = await encryptAuditEmail(piiProtector, actorEmail);
    await auditChainService.append({
      tenantId,
      entityType: 'member',
      entityId: plan.canonicalDocId,
      action: 'ROLE_CHANGE',
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details: `구성원 deep sync: ${entry.effectiveRole} -> ${targetRole}`,
      metadata: {
        source: 'auth_governance_deep_sync',
        previousRole: entry.effectiveRole,
        nextRole: targetRole,
        identityKey,
        canonicalDocId: plan.canonicalDocId,
        mirroredLegacyCount: plan.legacyPatches.length,
        claimsUpdated: Boolean(plan.claims && entry.authUid),
        reason: parsed.reason?.trim() || null,
        outboxId: outboxEvent.id,
      },
      timestamp,
    });

    return {
      status: 200,
      body: {
        identityKey,
        email: plan.email,
        canonicalDocId: plan.canonicalDocId,
        role: targetRole,
        mirroredLegacyCount: plan.legacyPatches.length,
        claimsUpdated: Boolean(plan.claims && entry.authUid),
        updatedAt: timestamp,
      },
    };
  }));
}
