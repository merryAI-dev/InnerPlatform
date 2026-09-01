import { describe, expect, it } from 'vitest';
import { PARTICIPATION_ROSTER_STATUS_COLLECTION } from '../participation-roster-worker.mjs';

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { mountParticipationRosterRoutes } = await import('./participation-roster.mjs');

const TENANT = 'tenant-a';

function createApp({ role = 'admin', documents = {}, idempotencyBegin, inlineResult } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: TENANT, actorId: 'actor-a', actorRole: role, requestId: 'req-1', idempotencyKey: 'idem-1',
    };
    next();
  });

  const writes = [];
  const makeQuery = (entries) => ({
    get: async () => ({
      docs: entries.map(([key, data]) => ({ id: key.split('/').pop(), data: () => data })),
    }),
    where: (field, _op, value) => makeQuery(entries.filter(([, data]) => data[field] === value)),
  });
  const db = {
    collection: (path) => makeQuery(
      Object.entries(documents).filter(([key]) => key.startsWith(`${path}/`)),
    ),
    doc: (path) => ({
      create: async (value) => { writes.push({ path, value }); },
    }),
  };
  const idempotencyCalls = { complete: 0, fail: 0 };
  const idempotencyService = {
    begin: idempotencyBegin || (async () => ({ mode: 'new', requestFingerprint: 'fp-1' })),
    complete: async () => { idempotencyCalls.complete += 1; },
    fail: async () => { idempotencyCalls.fail += 1; },
  };

  const inlineCalls = [];
  const processRosterEventInline = async (eventId) => {
    inlineCalls.push(eventId);
    return inlineResult ?? { processed: true, succeeded: true };
  };

  mountParticipationRosterRoutes(app, {
    db, now: () => '2026-08-25T09:00:00.000Z', idempotencyService, processRosterEventInline,
  });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  return { app, writes, idempotencyCalls, inlineCalls };
}

const STATUS_DOCS = {
  [`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/sheet-ok`]: {
    spreadsheetId: 'sheet-ok', spreadsheetTitle: '참여율 사본 A',
    sheetTabs: ['안내', '참조', '참여율 관리'],
    projects: [{ projectId: 'proj-1', projectName: '사업 하나' }],
    ok: true, lastAttemptAt: '2026-08-25T08:00:00.000Z', lastSuccessAt: '2026-08-25T08:00:00.000Z', writtenRows: 12,
  },
  [`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/sheet-bad`]: {
    spreadsheetId: 'sheet-bad', spreadsheetTitle: '참여율 사본 B',
    projects: [{ projectId: 'proj-2', projectName: '사업 둘' }],
    ok: false, reason: 'permission_denied', message: '공유 안 됨', lastAttemptAt: '2026-08-25T08:30:00.000Z',
  },
};

describe('GET /api/v1/participation-roster/push-status', () => {
  it('시트 제목·프로젝트명으로 상태를 돌려주고 최근 시도 순으로 정렬한다', async () => {
    const { app } = createApp({ role: 'viewer', documents: STATUS_DOCS });
    const res = await request(app).get('/api/v1/participation-roster/push-status');
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ total: 2, ok: 1, failed: 1, inactive: 0 });
    expect(res.body.statuses.map((status) => status.spreadsheetTitle)).toEqual(['참여율 사본 B', '참여율 사본 A']);
    expect(res.body.statuses[0]).toMatchObject({ reason: 'permission_denied', projects: [{ projectId: 'proj-2', projectName: '사업 둘' }] });
    expect(res.body.statuses.find((status) => status.spreadsheetId === 'sheet-ok').sheetTabs).toEqual(['안내', '참조', '참여율 관리']);
    expect(res.body.pendingPush).toEqual({ queued: 0, processing: 0, oldestQueuedAt: null });
  });

  it('active:false 이력은 집계에서 빼고, 대기 중인 outbox 이벤트를 보여준다', async () => {
    const { app } = createApp({
      role: 'viewer',
      documents: {
        ...STATUS_DOCS,
        [`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/sheet-gone`]: {
          spreadsheetId: 'sheet-gone', spreadsheetTitle: '해제된 시트', projects: [],
          ok: false, reason: 'permission_denied', active: false, lastAttemptAt: '2026-08-01T00:00:00.000Z',
        },
        'outbox/evt-1': {
          eventType: 'participation.roster.changed', status: 'PENDING',
          tenantId: TENANT, createdAt: '2026-08-25T08:50:00.000Z',
        },
        'outbox/evt-other-tenant': {
          eventType: 'participation.roster.changed', status: 'PENDING',
          tenantId: 'tenant-z', createdAt: '2026-08-25T08:40:00.000Z',
        },
      },
    });
    const res = await request(app).get('/api/v1/participation-roster/push-status');
    expect(res.body.counts).toEqual({ total: 2, ok: 1, failed: 1, inactive: 1 });
    expect(res.body.statuses.find((status) => status.spreadsheetId === 'sheet-gone').active).toBe(false);
    expect(res.body.pendingPush).toEqual({ queued: 1, processing: 0, oldestQueuedAt: '2026-08-25T08:50:00.000Z' });
  });
});

describe('POST /api/v1/participation-roster/push', () => {
  it('personWrite 역할이면 outbox 이벤트를 넣고 같은 요청 안에서 즉시 처리한다(200)', async () => {
    const { app, writes, idempotencyCalls, inlineCalls } = createApp({ role: 'finance' });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ processed: true, succeeded: true });
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`outbox/${res.body.eventId}`);
    expect(writes[0].value).toMatchObject({
      eventType: 'participation.roster.changed',
      tenantId: TENANT,
      payload: { trigger: 'manual', actorId: 'actor-a' },
    });
    expect(inlineCalls).toEqual([res.body.eventId]);
    expect(idempotencyCalls.complete).toBe(1);
  });

  it('인라인 처리가 안 되면 202 로 대기열에 남았음을 알린다 - 크론이 이어받는다', async () => {
    const { app, writes } = createApp({
      role: 'finance',
      inlineResult: { processed: false, reason: 'not_claimable' },
    });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ processed: false, succeeded: false });
    expect(writes).toHaveLength(1);
  });

  it('같은 idempotency 키의 재전송은 새 이벤트 대신 저장된 응답을 재생한다', async () => {
    const { app, writes } = createApp({
      role: 'finance',
      idempotencyBegin: async () => ({ mode: 'replay', status: 202, body: { ok: true, eventId: 'prev-event' } }),
    });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(202);
    expect(res.body.eventId).toBe('prev-event');
    expect(res.headers['x-idempotency-replayed']).toBe('1');
    expect(writes).toHaveLength(0);
  });

  it('viewer 는 실행할 수 없다', async () => {
    const { app, writes, idempotencyCalls } = createApp({ role: 'viewer' });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
    expect(idempotencyCalls.fail).toBe(1);
  });
});
