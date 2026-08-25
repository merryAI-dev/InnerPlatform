/**
 * 참조 명단 푸시 상태·수동 실행 라우트.
 *
 * 계약: docs/architecture/contracts/2026-08-25-participation-roster-push-contract.md
 * 상태 화면은 ID 가 아니라 "시트 제목 + 프로젝트명" 으로 말한다. "왜 우리 시트엔 새 사람이
 * 안 떠요?" 라는 문의가 왔을 때 보는 곳이 여기다.
 *
 * 수동 실행은 워커와 같은 outbox 이벤트를 넣을 뿐이다 - People 저장 훅이 나중에 붙어도
 * 경로는 하나다. 인라인으로 직접 밀지 않는다.
 */

import {
  asyncHandler, assertActorRoleAllowed, createHttpError, createMutatingRoute, ROUTE_ROLES, readOptionalText,
} from '../bff-utils.mjs';
import { enqueueOutboxEvent } from '../outbox.mjs';
import {
  PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE,
  PARTICIPATION_ROSTER_STATUS_COLLECTION,
  buildParticipationRosterOutboxEvent,
} from '../participation-roster-worker.mjs';

/**
 * 처리 대기 중인 명단 이벤트. outbox 워커는 크론(매일 1회)으로 돌므로 "실행했는데 왜
 * 반영이 안 되죠" 의 답은 대부분 여기다 - 대기 중임을 보여주지 않으면 사람이 또 누른다.
 */
async function readPendingRosterEvents(db, tenantId) {
  const statuses = ['PENDING', 'FAILED', 'PROCESSING'];
  const snaps = await Promise.all(statuses.map((status) => db.collection('outbox')
    .where('eventType', '==', PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE)
    .where('status', '==', status)
    .get()));
  const events = snaps
    .flatMap((snap) => snap.docs.map((doc) => doc.data() || {}))
    .filter((event) => event.tenantId === tenantId);
  const queuedAts = events
    .map((event) => readOptionalText(event.createdAt))
    .filter(Boolean)
    .sort();
  return {
    queued: events.filter((event) => event.status !== 'PROCESSING').length,
    processing: events.filter((event) => event.status === 'PROCESSING').length,
    oldestQueuedAt: queuedAts[0] || null,
  };
}

export function mountParticipationRosterRoutes(app, { db, now = () => new Date().toISOString(), idempotencyService } = {}) {
  app.get('/api/v1/participation-roster/push-status', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read participation roster push status');
    if (!db) throw createHttpError(503, '명단 푸시 상태를 읽을 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');

    const [snap, pendingPush] = await Promise.all([
      db.collection(`orgs/${tenantId}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}`).get(),
      readPendingRosterEvents(db, tenantId),
    ]);
    const statuses = snap.docs
      .map((doc) => {
        const status = doc.data() || {};
        return {
          spreadsheetId: readOptionalText(status.spreadsheetId) || null,
          spreadsheetTitle: readOptionalText(status.spreadsheetTitle) || readOptionalText(status.spreadsheetId) || doc.id,
          projects: Array.isArray(status.projects) ? status.projects : [],
          ok: status.ok === true,
          // active=false: 링크 해제·종료로 지금은 팬아웃 대상이 아닌 시트의 이력.
          active: status.active !== false,
          reason: readOptionalText(status.reason) || null,
          message: readOptionalText(status.message) || null,
          lastAttemptAt: readOptionalText(status.lastAttemptAt) || null,
          lastSuccessAt: readOptionalText(status.lastSuccessAt) || null,
          writtenRows: Number.isInteger(status.writtenRows) ? status.writtenRows : null,
        };
      })
      .sort((left, right) => String(right.lastAttemptAt || '').localeCompare(String(left.lastAttemptAt || '')))
      .slice(0, 500);
    const activeStatuses = statuses.filter((status) => status.active);

    res.status(200).json({
      statuses,
      counts: {
        total: activeStatuses.length,
        ok: activeStatuses.filter((status) => status.ok).length,
        failed: activeStatuses.filter((status) => !status.ok).length,
        inactive: statuses.length - activeStatuses.length,
      },
      pendingPush,
    });
  }));

  // createMutatingRoute 가 계약이다: idempotency-key 없는 POST 는 전역 미들웨어가 400 으로
  // 거르고, 같은 키의 재전송은 새 이벤트를 또 만드는 대신 저장된 응답을 재생한다.
  app.post('/api/v1/participation-roster/push', createMutatingRoute(idempotencyService, async (req) => {
    // 명단 푸시는 People 명부와 같은 민감도다 - personWrite(admin·tenant_admin·finance).
    assertActorRoleAllowed(req, ROUTE_ROLES.personWrite, 'trigger participation roster push');
    if (!db) throw createHttpError(503, '명단 푸시를 실행할 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');

    const event = buildParticipationRosterOutboxEvent({
      tenantId,
      requestId: readOptionalText(req.context?.requestId) || undefined,
      trigger: 'manual',
      actorId: readOptionalText(req.context?.actorId) || undefined,
      createdAt: now(),
    });
    await enqueueOutboxEvent(db, event);
    return { status: 202, body: { ok: true, eventId: event.id, eventType: event.eventType } };
  }));
}
