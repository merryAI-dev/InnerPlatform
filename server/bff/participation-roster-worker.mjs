/**
 * 참조 명단 푸시 워커 - outbox 이벤트 `participation.roster.changed` 의 핸들러.
 *
 * 계약: docs/architecture/contracts/2026-08-25-participation-roster-push-contract.md
 * 이벤트는 신호일 뿐이다. payload 의 명단을 믿지 않고 실행 시점에 항상 라이브 People 을
 * 읽어 쓴다 - 그래야 순서 꼬임이 원천적으로 없고, 같은 날 여러 변경이 자연히 1회로 합쳐진다.
 */

import { createHash } from 'node:crypto';
import { createOutboxEvent } from './outbox.mjs';
import {
  composeRosterRows,
  normalizeRosterPeople,
  pushRosterToLinkedSheets,
} from './participation-roster-push.mjs';

export const PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE = 'participation.roster.changed';
export const PARTICIPATION_ROSTER_STATUS_COLLECTION = 'participation_roster_push_status';

const text = (value) => String(value ?? '').trim();

/**
 * 트리거가 어디서 오든(사람 수동 실행, People 저장 훅) 같은 모양의 이벤트를 만든다.
 * payload 에는 출처만 담는다 - 명단은 담지 않는다.
 */
export function buildParticipationRosterOutboxEvent({ tenantId, requestId, trigger, actorId, createdAt }) {
  return createOutboxEvent({
    tenantId,
    requestId,
    eventType: PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE,
    entityType: 'participation_roster',
    entityId: tenantId,
    payload: { trigger: text(trigger) || 'manual', actorId: text(actorId) || null },
    ...(createdAt ? { createdAt } : {}),
  });
}

function statusDocId(result) {
  if (result.spreadsheetId) return result.spreadsheetId;
  // spreadsheet ID 를 못 뽑은 링크도 화면에 남아야 한다 - 조용히 사라지면 아무도 못 고친다.
  return `invalid-${createHash('sha1').update(text(result.link) || 'unknown').digest('hex').slice(0, 16)}`;
}

/**
 * 팬아웃 대상: 참여율 시트 링크가 있는 활성 프로젝트.
 * COMPLETED 만 제외한다 - 잔금 대기(COMPLETED_PENDING_PAYMENT)는 정산이 진행 중이라
 * 시트가 아직 살아 있다.
 */
function collectRosterLinks(projects) {
  return projects
    .filter((project) => text(project.participationSheetLink) && text(project.status) !== 'COMPLETED')
    .map((project) => ({
      link: project.participationSheetLink,
      projectId: project.id,
      projectName: text(project.name) || project.id,
    }));
}

export function createParticipationRosterChangedOutboxHandler({ db, googleSheetsService, now = () => new Date().toISOString() }) {
  return async (event) => {
    const tenantId = text(event?.tenantId);
    if (!tenantId) throw new Error('participation roster event requires tenantId');

    const [peopleSnap, projectsSnap] = await Promise.all([
      db.collection(`orgs/${tenantId}/persons`).get(),
      db.collection(`orgs/${tenantId}/projects`).get(),
    ]);
    const rosterRows = composeRosterRows(
      normalizeRosterPeople(peopleSnap.docs.map((doc) => doc.data() || {})),
    );
    const links = collectRosterLinks(
      projectsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    );

    const results = await pushRosterToLinkedSheets({
      sheetsService: googleSheetsService,
      rosterRows,
      links,
    });

    const nowIso = now();
    for (const result of results) {
      const ref = db.doc(`orgs/${tenantId}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/${statusDocId(result)}`);
      // 실패해도 이전 성공의 흔적(제목·lastSuccessAt)은 지우지 않는다 - merge 가 그 역할이다.
      const status = {
        spreadsheetId: result.spreadsheetId || null,
        projects: result.projects || [],
        ok: result.ok === true,
        reason: result.ok === true ? null : (result.reason || 'api_error'),
        message: result.ok === true ? null : (result.message || null),
        lastAttemptAt: nowIso,
        updatedAt: nowIso,
      };
      if (text(result.spreadsheetTitle)) status.spreadsheetTitle = result.spreadsheetTitle;
      if (result.ok === true) {
        status.lastSuccessAt = nowIso;
        status.writtenRows = result.writtenRows || 0;
      }
      await ref.set(status, { merge: true });
    }

    // 일시 장애(api_error)만 재시도한다. 권한·형식·링크 문제는 사람이 고쳐야 하는 상태라
    // 상태 문서에 남기고 이벤트는 성공으로 끝낸다 - 재시도가 고칠 수 없는 것을 재시도하면
    // 큐만 막힌다.
    const transient = results.filter((result) => !result.ok && result.reason === 'api_error');
    if (transient.length > 0) {
      const names = transient.map((result) => result.spreadsheetTitle || result.spreadsheetId).join(', ');
      throw new Error(`참조 명단을 일부 시트에 쓰지 못했습니다(일시 오류, 재시도 예정): ${names}`);
    }

    return {
      sheets: results.length,
      succeeded: results.filter((result) => result.ok).length,
      refused: results.filter((result) => !result.ok).length,
      rosterRows: rosterRows.length,
      at: nowIso,
    };
  };
}
