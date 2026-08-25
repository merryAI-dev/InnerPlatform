import { describe, expect, it } from 'vitest';
import { PARTICIPATION_ROSTER_STATUS_COLLECTION } from '../participation-roster-worker.mjs';

const { default: express } = await import('express');
const { default: request } = await import('supertest');
const { mountParticipationRosterRoutes } = await import('./participation-roster.mjs');

const TENANT = 'tenant-a';

function createApp({ role = 'admin', documents = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: TENANT, actorId: 'actor-a', actorRole: role, requestId: 'req-1' };
    next();
  });

  const writes = [];
  const db = {
    collection: (path) => ({
      get: async () => ({
        docs: Object.entries(documents)
          .filter(([key]) => key.startsWith(`${path}/`))
          .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data })),
      }),
    }),
    doc: (path) => ({
      create: async (value) => { writes.push({ path, value }); },
    }),
  };

  mountParticipationRosterRoutes(app, { db, now: () => '2026-08-25T09:00:00.000Z' });
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, message: error.message }));
  return { app, writes };
}

const STATUS_DOCS = {
  [`orgs/${TENANT}/${PARTICIPATION_ROSTER_STATUS_COLLECTION}/sheet-ok`]: {
    spreadsheetId: 'sheet-ok', spreadsheetTitle: '참여율 사본 A',
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
    expect(res.body.counts).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(res.body.statuses.map((status) => status.spreadsheetTitle)).toEqual(['참여율 사본 B', '참여율 사본 A']);
    expect(res.body.statuses[0]).toMatchObject({ reason: 'permission_denied', projects: [{ projectId: 'proj-2', projectName: '사업 둘' }] });
  });
});

describe('POST /api/v1/participation-roster/push', () => {
  it('personWrite 역할이면 outbox 이벤트를 넣고 202 를 돌려준다', async () => {
    const { app, writes } = createApp({ role: 'finance' });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(202);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`outbox/${res.body.eventId}`);
    expect(writes[0].value).toMatchObject({
      eventType: 'participation.roster.changed',
      tenantId: TENANT,
      payload: { trigger: 'manual', actorId: 'actor-a' },
    });
  });

  it('viewer 는 실행할 수 없다', async () => {
    const { app, writes } = createApp({ role: 'viewer' });
    const res = await request(app).post('/api/v1/participation-roster/push');
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });
});
