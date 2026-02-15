import { randomUUID } from 'node:crypto';
import { sha256, stableStringify } from './utils.mjs';

function buildAuditId(timestamp) {
  const ts = new Date(timestamp).toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return `al_${ts}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

function asPositiveInt(value, fallback = 0) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeHash(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hashAuditEntry(entry) {
  return sha256(stableStringify({
    tenantId: entry.tenantId,
    id: entry.id,
    chainSeq: entry.chainSeq,
    prevHash: entry.prevHash || null,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    userId: entry.userId,
    userName: entry.userName,
    userRole: entry.userRole || null,
    userEmailEnc: entry.userEmailEnc || null,
    requestId: entry.requestId,
    details: entry.details,
    metadata: entry.metadata || null,
    timestamp: entry.timestamp,
  }));
}

export function createAuditChainService(db, { now = () => new Date().toISOString() } = {}) {
  return {
    async append({
      tenantId,
      entityType,
      entityId,
      action,
      actorId,
      actorRole,
      actorEmailEnc,
      requestId,
      details,
      metadata,
      timestamp = now(),
    }) {
      return db.runTransaction(async (tx) => {
        const headRef = db.doc(`orgs/${tenantId}/audit_chain/head`);
        const headSnap = await tx.get(headRef);
        const head = headSnap.exists ? (headSnap.data() || {}) : {};

        const lastSeq = asPositiveInt(head.lastSeq, 0);
        const prevHash = normalizeHash(head.lastHash);
        const chainSeq = lastSeq + 1;
        const auditId = buildAuditId(timestamp);
        const logRef = db.doc(`orgs/${tenantId}/audit_logs/${auditId}`);

        const entry = {
          id: auditId,
          tenantId,
          entityType,
          entityId,
          action,
          userId: actorId,
          userName: actorId,
          userRole: actorRole || undefined,
          userEmailEnc: actorEmailEnc || undefined,
          requestId,
          details,
          metadata: metadata || undefined,
          timestamp,
          chainSeq,
          prevHash,
          hashAlg: 'sha256',
        };

        const hash = hashAuditEntry(entry);
        entry.hash = hash;

        tx.create(logRef, entry);
        tx.set(headRef, {
          tenantId,
          lastSeq: chainSeq,
          lastHash: hash,
          updatedAt: timestamp,
        }, { merge: true });

        return {
          id: auditId,
          chainSeq,
          hash,
          prevHash,
        };
      });
    },

    async verify({ tenantId, limit = 2000 } = {}) {
      const safeLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 2000, 1), 10000);
      const snap = await db
        .collection(`orgs/${tenantId}/audit_logs`)
        .orderBy('chainSeq', 'asc')
        .limit(safeLimit)
        .get();

      let previousHash = null;
      let previousSeq = null;
      let checked = 0;

      for (const doc of snap.docs) {
        const item = doc.data() || {};
        const seq = asPositiveInt(item.chainSeq, -1);

        if (seq <= 0) {
          return {
            ok: false,
            checked,
            brokenAtId: item.id || doc.id,
            reason: 'missing_or_invalid_chain_seq',
          };
        }

        if (previousSeq !== null && seq !== previousSeq + 1) {
          return {
            ok: false,
            checked,
            brokenAtId: item.id || doc.id,
            reason: `sequence_gap: expected=${previousSeq + 1} actual=${seq}`,
          };
        }

        const expectedPrev = previousHash;
        const actualPrev = normalizeHash(item.prevHash);
        if ((expectedPrev || null) !== (actualPrev || null)) {
          return {
            ok: false,
            checked,
            brokenAtId: item.id || doc.id,
            reason: 'prev_hash_mismatch',
          };
        }

        const expectedHash = hashAuditEntry(item);
        if (item.hash !== expectedHash) {
          return {
            ok: false,
            checked,
            brokenAtId: item.id || doc.id,
            reason: 'hash_mismatch',
          };
        }

        previousSeq = seq;
        previousHash = expectedHash;
        checked += 1;
      }

      return {
        ok: true,
        checked,
        lastSeq: previousSeq || 0,
        lastHash: previousHash,
      };
    },
  };
}
