import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildParticipationDashboardSnapshot, selectParticipationDashboardYear } from './participation-dashboard.mjs';
import { mountParticipationDashboardRoutes } from './routes/participation-dashboard.mjs';

const project = {
  id: 'agri-2026', clientOrg: '한국농업기술진흥원', settlementSystem: 'ACCOUNTANT',
  contractStart: '2026-01-01', contractEnd: '2026-12-31',
};
const secondProject = {
  id: 'hongsi-2026', clientOrg: '한국경영혁신중소기업협회', settlementSystem: 'ENARA',
  contractStart: '2026-01-01', contractEnd: '2026-12-31',
};

describe('participation dashboard', () => {
  it('uses client-org and settlement-system conditions to return server-calculated 12-month warning rows', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [project, secondProject],
      people: [
        { personId: 'psn-boram', name: '변민욱A', joinedAt: '2020-01-01' },
        { personId: 'psn-new', name: '가나다', joinedAt: '2025-01-01' },
      ],
      rules: [{ id: 'participation-rule-agri', kind: 'USER_DEFINED', alias: '농식품 + 회계사 정산', clientOrgs: [project.clientOrg, secondProject.clientOrg], settlementSystems: [project.settlementSystem, secondProject.settlementSystem] }],
      entries: [
        { id: 'a', projectId: project.id, personId: 'psn-boram', rate: 60, periodStart: '2026-01', periodEnd: '2026-12' },
        { id: 'b', projectId: project.id, personId: 'psn-boram', rate: 50, periodStart: '2026-03', periodEnd: '2026-04' },
        { id: 'c', projectId: secondProject.id, personId: 'psn-boram', rate: 10, periodStart: '2026-03', periodEnd: '2026-03' },
        { id: 'd', projectId: project.id, personId: 'psn-new', rate: 10, periodStart: '2026-03', periodEnd: '2026-03' },
        { id: 'legacy', projectId: project.id, memberId: 'legacy-row', memberName: '보람', rate: 30, periodStart: '2026-03', periodEnd: '2026-03' },
      ],
      generatedAt: '2026-08-12T00:00:00.000Z',
    });
    const result = selectParticipationDashboardYear(snapshot, '2026');

    expect(result.selectedRule).toMatchObject({ id: 'all', alias: '전체 인력' });
    const filtered = selectParticipationDashboardYear(snapshot, '2026', 'participation-rule-agri');
    expect(filtered.selectedRule).toMatchObject({ alias: '농식품 + 회계사 정산', clientOrgs: [project.clientOrg, secondProject.clientOrg] });
    expect(filtered.userRuleOptions).toEqual([{ id: 'participation-rule-agri', alias: '농식품 + 회계사 정산', clientOrgs: [project.clientOrg, secondProject.clientOrg], settlementSystems: [project.settlementSystem, secondProject.settlementSystem] }]);
    const boram = filtered.members.find((member) => member.memberId === 'psn-boram');
    expect(filtered.members[0].memberName).toBe('변민욱A');
    expect(boram.projectLabel).toBe('agri-2026 · hongsi-2026');
    expect(boram.projectCount).toBe(2);
    expect(boram.months[2]).toEqual({ yearMonth: '2026-03', label: '3월', rate: 120, isWarning: true });
    expect(filtered.warnings).toEqual(expect.arrayContaining([{ memberId: 'psn-boram', memberName: '변민욱A', yearMonth: '2026-03', rate: 120 }]));
    expect(selectParticipationDashboardYear(snapshot).selectedYear).toBe('2026');
    expect(snapshot.availableYears).toContain('2026');
    expect(result.unlinkedEntryCount).toBe(1);
    expect(result.filterOptions.settlementSystems).toEqual(expect.arrayContaining([{ value: 'NONE', label: '시스템 미사용' }]));
  });
});

describe('participation dashboard routes', () => {
  it('returns project participation as a server snapshot and saves a freely named rule', async () => {
    const saved = new Map();
    const docs = (items) => items.map((data) => ({ id: data.id, data: () => data }));
    const db = {
      collection(path) {
        const items = path.endsWith('/projects') ? [project, secondProject] : path.endsWith('/partEntries') ? [{ id: 'entry-1', projectId: project.id, personId: 'psn-boram', rate: 75 }] : path.endsWith('/persons') ? [{ personId: 'psn-boram', name: '변민욱A' }] : [];
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
    const snapshot = await request(app).get(`/api/v1/participation-dashboard/projects/${project.id}`).expect(200);
    expect(snapshot.body).toMatchObject({ projectId: project.id, headcount: 1, totalRate: 75, averageRate: 75, hasMembers: true });
    const response = await request(app).post('/api/v1/participation-dashboard/rules').set('Idempotency-Key', 'key').send({ alias: '농식품 + 회계사 정산', clientOrgs: [project.clientOrg], settlementSystems: [project.settlementSystem] }).expect(200);
    expect(saved.get(`orgs/mysc/participation_rules/${response.body.id}`)).toMatchObject({ alias: '농식품 + 회계사 정산', clientOrgs: [project.clientOrg], settlementSystems: [project.settlementSystem], kind: 'USER_DEFINED' });
  });
});
