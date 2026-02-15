import { createHash } from 'node:crypto';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeState(value) {
  return normalizeText(value).toUpperCase();
}

function toIso(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readTransactionAmount(tx) {
  const direct = toNumber(tx?.amount);
  if (direct > 0) return direct;
  return toNumber(tx?.amounts?.bankAmount);
}

function isAlreadyExistsError(error) {
  return !!(error && (error.code === 6 || /already exists/i.test(error.message || '')));
}

export function buildNotificationId({ eventId, recipientId }) {
  const raw = `${String(eventId || '')}|${String(recipientId || '')}`;
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 16);
  return `ntf_${hash}`;
}

export function buildTransactionStateNotificationDoc({
  tenantId,
  event,
  tx,
  recipientId,
  recipientRole,
  nowIso,
}) {
  const nextState = normalizeState(event?.payload?.nextState || tx?.state);
  const counterparty = normalizeText(tx?.counterparty) || String(tx?.id || '');
  const amount = readTransactionAmount(tx);

  const reason = normalizeText(event?.payload?.reason || tx?.rejectedReason) || null;
  const actorId = normalizeText(event?.payload?.actorId) || null;
  const actorRole = normalizeRole(event?.payload?.actorRole) || null;

  let title = '거래 업데이트';
  let severity = 'info';
  if (nextState === 'SUBMITTED') {
    title = '승인 필요: 거래 제출됨';
    severity = 'warning';
  } else if (nextState === 'APPROVED') {
    title = '승인 완료: 거래 승인됨';
    severity = 'info';
  } else if (nextState === 'REJECTED') {
    title = '반려: 거래 반려됨';
    severity = 'critical';
  }

  const description = nextState === 'REJECTED' && reason
    ? `${counterparty} · ${amount.toLocaleString('ko-KR')}원 · ${reason}`
    : `${counterparty} · ${amount.toLocaleString('ko-KR')}원`;

  const createdAt = toIso(event?.createdAt, nowIso);

  const docId = buildNotificationId({ eventId: event?.id, recipientId });
  return {
    id: docId,
    tenantId,
    recipientId,
    recipientRole: recipientRole || null,
    entityType: 'transaction',
    entityId: String(event?.entityId || tx?.id || ''),
    projectId: normalizeText(tx?.projectId) || null,
    ledgerId: normalizeText(tx?.ledgerId) || null,
    eventId: String(event?.id || ''),
    eventType: normalizeText(event?.eventType),
    state: nextState,
    title,
    description,
    severity,
    reason,
    actorId,
    actorRole,
    createdAt,
    readAt: null,
    updatedAt: createdAt,
  };
}

async function listApproverRecipients(db, tenantId, actorId) {
  const tenant = normalizeText(tenantId);
  if (!tenant) return [];

  const snap = await db
    .collection(`orgs/${tenant}/members`)
    .where('role', 'in', ['admin', 'finance'])
    .get();

  const recipients = [];
  for (const doc of snap.docs) {
    const member = doc.data() || {};
    const uid = normalizeText(member.uid || doc.id);
    if (!uid) continue;
    if (actorId && uid === actorId) continue;
    recipients.push({ id: uid, role: normalizeRole(member.role) || null });
  }
  return recipients;
}

export async function createNotificationsForOutboxEvent(db, event, nowIso) {
  if (!event || typeof event !== 'object') return { created: 0 };
  const eventType = normalizeText(event.eventType);
  const tenantId = normalizeText(event.tenantId);
  const entityId = normalizeText(event.entityId);
  if (!tenantId || !eventType || !entityId) return { created: 0 };

  if (eventType !== 'transaction.state_changed') return { created: 0 };

  const txSnap = await db.doc(`orgs/${tenantId}/transactions/${entityId}`).get();
  if (!txSnap.exists) return { created: 0 };
  const tx = { id: txSnap.id, ...(txSnap.data() || {}) };

  const nextState = normalizeState(event?.payload?.nextState || tx?.state);
  const actorId = normalizeText(event?.payload?.actorId);

  const notifications = [];

  if (nextState === 'SUBMITTED') {
    const recipients = await listApproverRecipients(db, tenantId, actorId);
    for (const recipient of recipients) {
      notifications.push(buildTransactionStateNotificationDoc({
        tenantId,
        event,
        tx,
        recipientId: recipient.id,
        recipientRole: recipient.role,
        nowIso,
      }));
    }
  } else if (nextState === 'APPROVED' || nextState === 'REJECTED') {
    const submitter = normalizeText(tx?.submittedBy || tx?.createdBy);
    if (submitter && submitter !== actorId) {
      let submitterRole = null;
      try {
        const memberSnap = await db.doc(`orgs/${tenantId}/members/${submitter}`).get();
        if (memberSnap.exists) {
          submitterRole = normalizeRole(memberSnap.data()?.role) || null;
        }
      } catch {
        // ignore recipient role lookup failures
      }
      notifications.push(buildTransactionStateNotificationDoc({
        tenantId,
        event,
        tx,
        recipientId: submitter,
        recipientRole: submitterRole,
        nowIso,
      }));
    }
  }

  let created = 0;
  for (const doc of notifications) {
    const ref = db.doc(`orgs/${tenantId}/notifications/${doc.id}`);
    try {
      await ref.create(doc);
      created += 1;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }

  return { created };
}

