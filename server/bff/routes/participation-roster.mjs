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
  asyncHandler, assertActorRoleAllowed, createHttpError, ROUTE_ROLES, readOptionalText,
} from '../bff-utils.mjs';
import { enqueueOutboxEvent } from '../outbox.mjs';
import {
  PARTICIPATION_ROSTER_STATUS_COLLECTION,
  buildParticipationRosterOutboxEvent,
} from '../participation-roster-worker.mjs';

export function mountParticipationRosterRoutes(app, { db, now = () => new Date().toISOString() } = {}) {
  app.get('/api/v1/participation-roster/push-status', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read participation roster push status');
    if (!db) throw createHttpError(503, '명단 푸시 상태를 읽을 수 없습니다.', 'firestore_unconfigured');
    const tenantId = readOptionalText(req.context?.tenantId);
    if (!tenantId) throw createHttpError(400, 'tenantId is required.', 'tenant_required');

    const snap = await db.collection(`orgs/${tenantId}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}`).get();
    const statuses = snap.docs
      .map((doc) => {
        const status = doc.data() || {};
        return {
          spreadsheetId: readOptionalText(status.spreadsheetId) || null,
          spreadsheetTitle: readOptionalText(status.spreadsheetTitle) || readOptionalText(status.spreadsheetId) || doc.id,
          projects: Array.isArray(status.projects) ? status.projects : [],
          ok: status.ok === true,
          reason: readOptionalText(status.reason) || null,
          message: readOptionalText(status.message) || null,
          lastAttemptAt: readOptionalText(status.lastAttemptAt) || null,
          lastSuccessAt: readOptionalText(status.lastSuccessAt) || null,
          writtenRows: Number.isInteger(status.writtenRows) ? status.writtenRows : null,
        };
      })
      .sort((left, right) => String(right.lastAttemptAt || '').localeCompare(String(left.lastAttemptAt || '')));

    res.status(200).json({
      statuses,
      counts: {
        total: statuses.length,
        ok: statuses.filter((status) => status.ok).length,
        failed: statuses.filter((status) => !status.ok).length,
      },
    });
  }));

  app.post('/api/v1/participation-roster/push', asyncHandler(async (req, res) => {
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
    res.status(202).json({ ok: true, eventId: event.id, eventType: event.eventType });
  }));
}
