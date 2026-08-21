import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  buildParticipationDashboardSnapshot,
  buildProjectParticipationSnapshot,
  selectParticipationDashboardYear,
} from './participation-dashboard.mjs';
import { mountParticipationDashboardRoutes } from './routes/participation-dashboard.mjs';

const project = {
  id: 'agri-2026', clientOrg: '한국농업기술진흥원', settlementSystem: 'ACCOUNTANT',
  contractStart: '2026-01-01', contractEnd: '2026-12-31',
};
const secondProject = {
  id: 'hongsi-2026', clientOrg: '한국경영혁신중소기업협회', settlementSystem: 'E_NARA_DOUM',
  contractStart: '2026-01-01', contractEnd: '2026-12-31',
};
const legacySettlementProject = {
  id: 'koica-legacy',
  clientOrg: 'KOICA',
  settlementType: 'TYPE5',
  accountType: 'DEDICATED',
  contractStart: '2026-01-01',
  contractEnd: '2026-12-31',
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
    expect(boram.months[2]).toEqual({
      yearMonth: '2026-03', label: '3월', rate: 120,
      isConfirmed: true, hasMissing: false, isWarning: true,
    });
    expect(filtered.warnings).toEqual(expect.arrayContaining([{ memberId: 'psn-boram', memberName: '변민욱A', yearMonth: '2026-03', rate: 120 }]));
    expect(selectParticipationDashboardYear(snapshot).selectedYear).toBe('2026');
    expect(snapshot.availableYears).toContain('2026');
    expect(result.unlinkedEntryCount).toBe(1);
    expect(result.filterOptions.settlementSystems).toEqual(expect.arrayContaining([{ value: 'NONE', label: '시스템 미사용' }]));
  });

  it('legacy 정산 필드도 저장 경로와 같은 플랫폼으로 분류한다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [legacySettlementProject],
      people: [{ personId: 'psn-legacy', name: '레거시 참여자' }],
      rules: [{
        id: 'koica-enara',
        kind: 'USER_DEFINED',
        alias: 'KOICA · e나라도움',
        clientOrgs: ['KOICA'],
        settlementSystems: ['E_NARA_DOUM'],
      }],
      entries: [{
        id: 'legacy-entry',
        projectId: legacySettlementProject.id,
        personId: 'psn-legacy',
        rate: 20,
        periodStart: '2026-01',
        periodEnd: '2026-12',
      }],
    });

    expect(selectParticipationDashboardYear(snapshot, '2026', 'koica-enara').members).toEqual([
      expect.objectContaining({ memberId: 'psn-legacy', projectCount: 1 }),
    ]);
    expect(snapshot.filterOptions.settlementSystems).toContainEqual({
      value: 'E_NARA_DOUM',
      label: 'e나라도움',
    });
  });

  it('sheet-backed 월별 맵의 빈칸을 legacy 기본률로 되살리지 않는다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [project],
      people: [{ personId: 'psn-sheet', name: '시트 인력', joinedAt: '2020-01-01' }],
      rules: [],
      entries: [{
        id: 'sheet-entry',
        projectId: project.id,
        personId: 'psn-sheet',
        rate: 30,
        periodStart: '2026-01',
        periodEnd: '2026-03',
        monthlyRates: { '2026-01': 0, '2026-03': 10 },
      }],
      generatedAt: '2026-08-21T00:00:00.000Z',
    });

    const member = selectParticipationDashboardYear(snapshot, '2026').members[0];
    expect(member.months.slice(0, 3).map(({ rate, isConfirmed, hasMissing }) => ({
      rate, isConfirmed, hasMissing,
    }))).toEqual([
      { rate: 0, isConfirmed: true, hasMissing: false },
      { rate: 0, isConfirmed: false, hasMissing: true },
      { rate: 10, isConfirmed: true, hasMissing: false },
    ]);
  });

  it('전월 미입력인 다년도 sheet-backed stint도 중간 연도를 조회할 수 있다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [{ ...project, contractStart: '2025-04-01', contractEnd: '2035-06-30' }],
      people: [{ personId: 'psn-sheet', name: '시트 인력', joinedAt: '2020-01-01' }],
      rules: [],
      entries: [{
        id: 'sheet-entry',
        projectId: project.id,
        personId: 'psn-sheet',
        rate: 20,
        periodStart: '2025-04',
        periodEnd: '2035-06',
        monthlyRates: {},
      }],
      generatedAt: '2026-08-21T00:00:00.000Z',
    });

    expect(snapshot.availableYears).toEqual(expect.arrayContaining(['2025', '2026', '2030', '2035']));
    expect(selectParticipationDashboardYear(snapshot, '2030').members[0].months.every(({ rate }) => rate === 0)).toBe(true);
  });

  it('PROJECT_TEAM_SYNC가 소유한 사람·사업·월은 MANUAL 문서를 보존하되 이중 집계하지 않는다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [project],
      people: [{ personId: 'psn-sheet', name: '시트 인력', joinedAt: '2020-01-01' }],
      rules: [],
      entries: [
        {
          id: 'manual-entry',
          source: 'MANUAL',
          projectId: project.id,
          personId: 'psn-sheet',
          rate: 5,
          periodStart: '2026-01',
          periodEnd: '2026-03',
        },
        {
          id: 'sheet-entry',
          source: 'PROJECT_TEAM_SYNC',
          projectId: project.id,
          personId: 'psn-sheet',
          rate: 20,
          periodStart: '2026-01',
          periodEnd: '2026-03',
          monthlyRates: { '2026-01': 20, '2026-02': null, '2026-03': 10 },
        },
      ],
      generatedAt: '2026-08-21T00:00:00.000Z',
    });

    const member = selectParticipationDashboardYear(snapshot, '2026').members[0];
    expect(member.months.slice(0, 3).map(({ rate, isConfirmed, hasMissing }) => ({
      rate, isConfirmed, hasMissing,
    }))).toEqual([
      { rate: 20, isConfirmed: true, hasMissing: false },
      { rate: 0, isConfirmed: false, hasMissing: true },
      { rate: 10, isConfirmed: true, hasMissing: false },
    ]);
  });

  it('프로젝트별 참여인력 요약도 PROJECT_TEAM_SYNC와 MANUAL을 이중 집계하지 않는다', () => {
    const result = buildProjectParticipationSnapshot({
      project,
      entries: [
        {
          id: 'manual-entry', source: 'MANUAL', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 5,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
        {
          id: 'sheet-entry', source: 'PROJECT_TEAM_SYNC', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 20,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
      ],
    });

    expect(result).toMatchObject({ headcount: 1, totalRate: 20, averageRate: 20 });
    expect(result.members[0]).toMatchObject({ entryCount: 1, totalRate: 20 });
    expect(result.members[0].entries).toEqual([
      expect.objectContaining({ id: 'sheet-entry', source: 'PROJECT_TEAM_SYNC' }),
    ]);
  });

  it('legacy MANUAL에 personId가 없어도 같은 memberId의 시트 참여행과 겹치면 이중 집계하지 않는다', () => {
    const result = buildProjectParticipationSnapshot({
      project,
      entries: [
        {
          id: 'legacy-manual', source: 'MANUAL', projectId: project.id,
          memberId: 'member-sheet', memberName: '시트 인력', rate: 5,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
        {
          id: 'sheet-entry', source: 'PROJECT_TEAM_SYNC', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 20,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
      ],
    });

    expect(result).toMatchObject({ headcount: 1, totalRate: 20, averageRate: 20 });
    expect(result.members[0].entries.map(({ id }) => id)).toEqual(['sheet-entry']);
  });

  it('서로 다른 personId의 MANUAL은 같은 legacy memberId여도 제거하지 않는다', () => {
    const result = buildProjectParticipationSnapshot({
      project,
      entries: [
        {
          id: 'manual-other-person', source: 'MANUAL', projectId: project.id,
          personId: 'psn-other', memberId: 'member-sheet', memberName: '다른 사람', rate: 5,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
        {
          id: 'sheet-entry', source: 'PROJECT_TEAM_SYNC', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 20,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
      ],
    });

    expect(result).toMatchObject({ totalRate: 25 });
    expect(result.members[0].entries.map(({ id }) => id)).toEqual([
      'manual-other-person',
      'sheet-entry',
    ]);
  });

  it('프로젝트별 요약에서 시트 기간과 겹치지 않는 수기 참여행은 보존한다', () => {
    const result = buildProjectParticipationSnapshot({
      project,
      entries: [
        {
          id: 'manual-before-sheet', source: 'MANUAL', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 5,
          periodStart: '2025-01', periodEnd: '2025-12',
        },
        {
          id: 'manual-without-period', source: 'MANUAL', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 3,
        },
        {
          id: 'sheet-entry', source: 'PROJECT_TEAM_SYNC', projectId: project.id,
          personId: 'psn-sheet', memberId: 'member-sheet', memberName: '시트 인력', rate: 20,
          periodStart: '2026-01', periodEnd: '2026-03',
        },
      ],
    });

    expect(result).toMatchObject({ headcount: 1, totalRate: 28, averageRate: 28 });
    expect(result.members[0]).toMatchObject({ entryCount: 3, totalRate: 28 });
    expect(result.members[0].entries.map(({ id }) => id)).toEqual([
      'manual-before-sheet',
      'manual-without-period',
      'sheet-entry',
    ]);
  });
});

describe('participation dashboard routes', () => {
  it('returns project participation as a server snapshot and saves a freely named rule', async () => {
    const saved = new Map();
    const docs = (items) => items.map((data) => ({ id: data.id, data: () => data }));
    const db = {
      collection(path) {
        const items = path.endsWith('/projects') ? [project, legacySettlementProject] : path.endsWith('/partEntries') ? [{ id: 'entry-1', projectId: project.id, personId: 'psn-boram', rate: 75 }] : path.endsWith('/persons') ? [{ personId: 'psn-boram', name: '변민욱A' }] : [];
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
    const legacyResponse = await request(app).post('/api/v1/participation-dashboard/rules').set('Idempotency-Key', 'legacy-key').send({ alias: 'KOICA · e나라도움', clientOrgs: ['KOICA'], settlementSystems: ['E_NARA_DOUM'] }).expect(200);
    expect(saved.get(`orgs/mysc/participation_rules/${legacyResponse.body.id}`)).toMatchObject({ clientOrgs: ['KOICA'], settlementSystems: ['E_NARA_DOUM'] });
  });
});
