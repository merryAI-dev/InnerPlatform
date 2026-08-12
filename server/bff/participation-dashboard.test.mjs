import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildParticipationDashboardSnapshot, buildParticipationRule, selectParticipationDashboardYear } from './participation-dashboard.mjs';
import { mountParticipationDashboardRoutes } from './routes/participation-dashboard.mjs';

const project = {
  id: 'agri-2026', clientOrg: '한국농업기술진흥원', settlementSystem: 'ACCOUNTANT',
  contractStart: '2026-01-01', contractEnd: '2026-12-31',
};

describe('participation dashboard', () => {
  it('uses the stored alias and returns server-calculated 12-month warning rows', () => {
    const rule = buildParticipationRule(project);
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [project],
      rules: [{ id: rule.id, alias: '농식품 규칙' }],
      entries: [
        { id: 'a', projectId: project.id, memberId: 'm-1', memberName: '보람', rate: 60, periodStart: '2026-01', periodEnd: '2026-12' },
        { id: 'b', projectId: project.id, memberId: 'm-1', memberName: '보람', rate: 50, periodStart: '2026-03', periodEnd: '2026-04' },
      ],
      generatedAt: '2026-08-12T00:00:00.000Z',
    });
    const result = selectParticipationDashboardYear(snapshot, '2026');

    expect(result.rules[0]).toMatchObject({ alias: '농식품 규칙' });
    expect(result.rules[0].members[0].months[2]).toEqual({ yearMonth: '2026-03', label: '3월', rate: 110, isWarning: true });
    expect(result.rules[0].warnings).toEqual(expect.arrayContaining([{ memberId: 'm-1', memberName: '보람', yearMonth: '2026-03', rate: 110 }]));
  });
});

describe('participation dashboard routes', () => {
  it('returns project participation as a server snapshot and only saves generated aliases', async () => {
    const saved = new Map();
    const docs = (items) => items.map((data) => ({ id: data.id, data: () => data }));
    const db = {
      collection(path) {
        const items = path.endsWith('/projects') ? [project] : path.endsWith('/partEntries') ? [{ id: 'entry-1', projectId: project.id, memberId: 'm-1', memberName: '보람', rate: 75 }] : [];
        return { get: async () => ({ docs: docs(items) }) };
      },
      doc(path) {
        if (path.endsWith(`/projects/${project.id}`)) return { id: project.id, exists: true, data: () => project, get: async () => ({ id: project.id, exists: true, data: () => project }) };
        return { set: async (value) => saved.set(path, value) };
      },
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.context = { tenantId: 'mysc', actorRole: 'admin', actorId: 'u-1' }; next(); });
    const idempotencyService = { begin: async () => ({ mode: 'proceed', requestFingerprint: 'f' }), complete: async () => {}, fail: async () => {} };
    mountParticipationDashboardRoutes(app, { db, now: () => '2026-08-12T00:00:00.000Z', idempotencyService });
    app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
    const rule = buildParticipationRule(project);

    const snapshot = await request(app).get(`/api/v1/participation-dashboard/projects/${project.id}`).expect(200);
    expect(snapshot.body).toMatchObject({ projectId: project.id, headcount: 1, totalRate: 75, averageRate: 75, hasMembers: true });
    await request(app).post(`/api/v1/participation-dashboard/rules/${rule.id}`).set('Idempotency-Key', 'key').send({ alias: '농식품 규칙' }).expect(200);
    expect(saved.get(`orgs/mysc/participation_rules/${rule.id}`)).toMatchObject({ alias: '농식품 규칙' });
    await request(app).post('/api/v1/participation-dashboard/rules/not-generated').set('Idempotency-Key', 'key2').send({ alias: '임의 규칙' }).expect(404);
  });
});
