import { describe, expect, it } from 'vitest';
import {
  PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE,
  PARTICIPATION_ROSTER_STATUS_COLLECTION,
  buildParticipationRosterOutboxEvent,
  createParticipationRosterChangedOutboxHandler,
} from './participation-roster-worker.mjs';

const TENANT = 'tenant-a';
const LINK_A = 'https://docs.google.com/spreadsheets/d/sheet-alpha-000000000001/edit';
const LINK_B = 'https://docs.google.com/spreadsheets/d/sheet-beta-0000000000002/edit';

const DOCUMENTS = {
  [`orgs/${TENANT}/persons/p-1`]: { nickname: '보람', name: '변민욱' },
  [`orgs/${TENANT}/persons/p-2`]: { nickname: '가든', name: '김신영' },
  [`orgs/${TENANT}/projects/proj-1`]: { name: '사업 하나', status: 'IN_PROGRESS', participationSheetLink: LINK_A },
  [`orgs/${TENANT}/projects/proj-2`]: { name: '사업 둘', status: 'COMPLETED_PENDING_PAYMENT', participationSheetLink: LINK_A },
  [`orgs/${TENANT}/projects/proj-3`]: { name: '끝난 사업', status: 'COMPLETED', participationSheetLink: LINK_B },
  [`orgs/${TENANT}/projects/proj-4`]: { name: '링크 없는 사업', status: 'IN_PROGRESS' },
  [`orgs/${TENANT}/projects/proj-5`]: { name: '휴지통 사업', status: 'IN_PROGRESS', participationSheetLink: LINK_B, trashedAt: '2026-08-20T00:00:00.000Z' },
};

function fakeDb(documents = DOCUMENTS) {
  const writes = [];
  return {
    writes,
    collection: (path) => ({
      get: async () => ({
        docs: Object.entries(documents)
          .filter(([key]) => key.startsWith(`${path}/`))
          .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data })),
      }),
    }),
    doc: (path) => ({
      set: async (value, options) => { writes.push({ path, value, options }); },
    }),
  };
}

function fakeSheetsService({ metaErrorFor = {}, marker = 'MYSC-PARTICIPATION-V2' } = {}) {
  const calls = { updates: [] };
  return {
    calls,
    service: {
      async getSpreadsheetMeta(spreadsheetId) {
        if (metaErrorFor[spreadsheetId]) throw metaErrorFor[spreadsheetId];
        return {
          spreadsheetId,
          spreadsheetTitle: `제목:${spreadsheetId}`,
          availableSheets: [{ sheetId: 1, title: '참조', index: 0 }],
        };
      },
      async getSheetValues({ rangeA1 }) {
        if (rangeA1 === 'F1:G1') return [[marker, '']];
        if (rangeA1 === 'A2:B') return [['가든', '김신영']];
        return [];
      },
      async batchUpdateValues(payload) {
        calls.updates.push(payload);
        return { totalUpdatedRows: payload.updates[0].values.length };
      },
    },
  };
}

const NOW = '2026-08-25T09:00:00.000Z';

function runHandler({ db = fakeDb(), sheets = fakeSheetsService() } = {}) {
  const handler = createParticipationRosterChangedOutboxHandler({
    db, googleSheetsService: sheets.service, now: () => NOW,
  });
  return { db, sheets, run: () => handler({ tenantId: TENANT }) };
}

describe('participation.roster.changed 핸들러', () => {
  it('라이브 People 로 명단을 만들어 링크된 활성 프로젝트의 시트에만 1회씩 쓴다', async () => {
    const { sheets, run } = runHandler();
    const summary = await run();
    // proj-1·proj-2 는 같은 시트(중복 제거 1회), COMPLETED·무링크·휴지통(trashedAt)은 제외.
    expect(sheets.calls.updates).toHaveLength(1);
    const written = sheets.calls.updates[0].updates[0].values;
    expect(written.slice(0, 2)).toEqual([['가든', '김신영'], ['보람', '변민욱']]);
    expect(written[written.length - 1]).toEqual(['미정-10', '']);
    expect(summary).toMatchObject({ sheets: 1, succeeded: 1, refused: 0, people: 2 });
  });

  it('대상에서 빠진 시트의 상태 문서는 active:false 로 내린다 - 지우지 않는다', async () => {
    const db = fakeDb({
      ...DOCUMENTS,
      [`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/old-sheet-000000000009`]: { ok: false, reason: 'permission_denied', active: true },
    });
    const { db: usedDb, run } = runHandler({ db });
    await run();
    const demoted = usedDb.writes.find((write) => write.path.endsWith('/old-sheet-000000000009'));
    expect(demoted.value).toEqual({ active: false, updatedAt: NOW });
    const current = usedDb.writes.find((write) => write.path.endsWith('/sheet-alpha-000000000001'));
    expect(current.value).toMatchObject({ active: true, ok: true });
  });

  it('People 조회가 0명이면 시트를 건드리지 않고 people_empty 로 남긴다 - 던지지 않는다', async () => {
    const db = fakeDb({
      [`orgs/${TENANT}/projects/proj-1`]: { name: '사업 하나', status: 'IN_PROGRESS', participationSheetLink: LINK_A },
    });
    const { db: usedDb, sheets, run } = runHandler({ db });
    const summary = await run();
    expect(sheets.calls.updates).toHaveLength(0);
    expect(summary).toMatchObject({ succeeded: 0, refused: 1, people: 0 });
    const statusWrite = usedDb.writes.find((write) => write.path.includes(PARTICIPATION_ROSTER_STATUS_COLLECTION));
    expect(statusWrite.value).toMatchObject({ ok: false, reason: 'people_empty' });
  });

  it('성공한 시트의 상태 문서에 제목·프로젝트명·lastSuccessAt 을 기록한다', async () => {
    const { db, run } = runHandler();
    await run();
    const statusWrites = db.writes.filter((write) => write.path.includes(PARTICIPATION_ROSTER_STATUS_COLLECTION));
    expect(statusWrites).toHaveLength(1);
    expect(statusWrites[0].path).toBe(`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/sheet-alpha-000000000001`);
    expect(statusWrites[0].options).toEqual({ merge: true });
    expect(statusWrites[0].value).toMatchObject({
      ok: true,
      spreadsheetTitle: '제목:sheet-alpha-000000000001',
      sheetTabs: ['참조'],
      lastSuccessAt: NOW,
      reason: null,
    });
    expect(statusWrites[0].value.projects.map((project) => project.projectName)).toEqual(['사업 하나', '사업 둘']);
  });

  it('권한 실패는 상태에 남기고 이벤트는 성공으로 끝낸다 - 재시도가 고칠 수 없다', async () => {
    const sheets = fakeSheetsService({
      metaErrorFor: { 'sheet-alpha-000000000001': Object.assign(new Error('공유 안 됨'), { statusCode: 403 }) },
    });
    const { db, run } = runHandler({ sheets });
    const summary = await run();
    expect(summary).toMatchObject({ succeeded: 0, refused: 1 });
    const statusWrite = db.writes.find((write) => write.path.includes(PARTICIPATION_ROSTER_STATUS_COLLECTION));
    expect(statusWrite.value).toMatchObject({ ok: false, reason: 'permission_denied' });
    expect(statusWrite.value).not.toHaveProperty('lastSuccessAt');
  });

  it('일시 오류(api_error)는 상태를 기록한 뒤 던져서 outbox 재시도에 태운다', async () => {
    const sheets = fakeSheetsService({
      metaErrorFor: { 'sheet-alpha-000000000001': Object.assign(new Error('quota'), { statusCode: 502 }) },
    });
    const { db, run } = runHandler({ sheets });
    await expect(run()).rejects.toThrow(/재시도 예정/);
    const statusWrite = db.writes.find((write) => write.path.includes(PARTICIPATION_ROSTER_STATUS_COLLECTION));
    expect(statusWrite.value).toMatchObject({ ok: false, reason: 'api_error' });
  });

  it('spreadsheet ID 를 못 뽑는 링크도 invalid- 문서로 화면에 남는다', async () => {
    const db = fakeDb({
      [`orgs/${TENANT}/persons/p-1`]: { nickname: '보람', name: '변민욱' },
      [`orgs/${TENANT}/projects/proj-x`]: { name: '깨진 링크 사업', status: 'IN_PROGRESS', participationSheetLink: 'broken' },
    });
    const { db: usedDb, run } = runHandler({ db });
    await run();
    const statusWrite = usedDb.writes.find((write) => write.path.includes(PARTICIPATION_ROSTER_STATUS_COLLECTION));
    expect(statusWrite.path).toMatch(/\/invalid-[0-9a-f]{16}$/);
    expect(statusWrite.value).toMatchObject({ ok: false, reason: 'invalid_link' });
  });
});

describe('buildParticipationRosterOutboxEvent', () => {
  it('트리거가 어디서 오든 같은 이벤트 모양이고 payload 에 명단이 없다', () => {
    const event = buildParticipationRosterOutboxEvent({
      tenantId: TENANT, requestId: 'req-1', trigger: 'manual', actorId: 'actor-1', createdAt: NOW,
    });
    expect(event.eventType).toBe(PARTICIPATION_ROSTER_CHANGED_EVENT_TYPE);
    expect(event.entityId).toBe(TENANT);
    expect(event.payload).toEqual({ trigger: 'manual', actorId: 'actor-1' });
    expect(event.status).toBe('PENDING');
  });
});
