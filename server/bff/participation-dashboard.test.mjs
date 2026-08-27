import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  buildParticipationDashboardSnapshot,
  buildProjectParticipationSnapshot,
  selectParticipationDashboardYear,
} from './participation-dashboard.mjs';
import { createBffApp } from './app.mjs';
import { getProfessionalProfileCatalog } from './professional-profile.mjs';
import {
  PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES,
  PARTICIPATION_SETTLEMENT_SYSTEM_LABELS,
} from './participation-settlement-system.mjs';
import { mountParticipationDashboardRoutes } from './routes/participation-dashboard.mjs';
import {
  PROJECT_SETTLEMENT_SYSTEM_CODES,
  SETTLEMENT_SYSTEM_LABELS,
} from '../../src/app/data/types.ts';

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

const profilePolicy = ({ readers = ['admin', 'finance'] } = {}) => ({
  roles: ['admin', 'finance', 'pm', 'viewer'],
  permissions: ['person:professional_profile:read'],
  rolePermissions: Object.fromEntries(
    ['admin', 'finance', 'pm', 'viewer'].map((role) => [
      role,
      readers.includes(role) ? ['person:professional_profile:read'] : [],
    ]),
  ),
});

const masterGbToeicPmp = {
  educationRecords: [
    {
      attainmentCode: 'BACHELOR_GRADUATED',
      institutionName: '연세대학교',
      countryCode: 'KR',
      major: '경영학',
    },
    {
      attainmentCode: 'MASTER_GRADUATED',
      institutionName: 'University of Sussex',
      countryCode: 'GB',
      major: 'PROFILE_FIXTURE_SECRET',
    },
  ],
  englishEvidence: [{
    testCode: 'TOEIC',
    scaleCode: 'TOEIC_990',
    resultValue: '920',
    otherTestName: null,
    testedAt: '2026-06',
  }],
  certifications: [{ key: 'pmp', label: 'PMP' }],
};

const bachelorKrToefl = {
  educationRecords: [{
    attainmentCode: 'BACHELOR_GRADUATED',
    institutionName: '고려대학교',
    countryCode: 'KR',
    major: null,
  }],
  englishEvidence: [{
    testCode: 'TOEFL',
    scaleCode: 'TOEFL_IBT_120',
    resultValue: '105',
    otherTestName: null,
    testedAt: '2025-12',
  }],
  certifications: [{ key: 'oda 전문가', label: 'ODA 전문가' }],
};

function buildProfessionalProfileFixture() {
  const projects = [
    { id: 'koica-a', name: 'KOICA A', clientOrg: 'KOICA', settlementSystem: 'E_NARA_DOUM' },
    { id: 'koica-b', name: 'KOICA B', clientOrg: 'KOICA', settlementSystem: 'RCMS' },
    { id: 'test-a', name: 'TEST A', clientOrg: 'TEST', settlementSystem: 'NONE' },
  ];
  const people = [
    {
      personId: 'p1', name: '김정태', email: 'secret-p1@example.com', uid: 'secret-uid-p1',
      note: 'PERSON_NOTE_SECRET', professionalProfile: masterGbToeicPmp,
    },
    { personId: 'p2', name: '이예지', professionalProfile: bachelorKrToefl },
    { personId: 'p3', name: '김세은' },
    {
      personId: 'p4', name: '과거인력', professionalProfile: {
        educationRecords: [{ attainmentCode: 'DOCTOR_GRADUATED', countryCode: 'KR' }],
        englishEvidence: [{ testCode: 'TOEIC', scaleCode: 'TOEIC_990', resultValue: '990' }],
        certifications: [{ key: 'pmp', label: 'PMP' }],
      },
    },
  ];
  const rules = [
    {
      id: 'koica', kind: 'USER_DEFINED', alias: 'KOICA', clientOrgs: ['KOICA'],
      settlementSystems: ['E_NARA_DOUM', 'RCMS'],
    },
    {
      id: 'test', kind: 'USER_DEFINED', alias: 'TEST', clientOrgs: ['TEST'],
      settlementSystems: ['NONE'],
    },
  ];
  const entries = [
    { id: 'p1-a', projectId: 'koica-a', personId: 'p1', rate: 60, periodStart: '2026-01', periodEnd: '2026-01' },
    { id: 'p1-b', projectId: 'koica-b', personId: 'p1', rate: 50, periodStart: '2026-01', periodEnd: '2026-01' },
    { id: 'p2-a', projectId: 'koica-a', personId: 'p2', rate: 45, periodStart: '2026-02', periodEnd: '2026-02' },
    {
      id: 'p3-a', source: 'PROJECT_TEAM_SYNC', projectId: 'koica-b', personId: 'p3',
      periodStart: '2026-03', periodEnd: '2026-03', monthlyRates: {},
    },
    { id: 'p3-test', projectId: 'test-a', personId: 'p3', rate: 10, periodStart: '2026-04', periodEnd: '2026-04' },
    { id: 'p4-old', projectId: 'koica-a', personId: 'p4', rate: 30, periodStart: '2025-01', periodEnd: '2025-12' },
    { id: 'unlinked', projectId: 'koica-a', personId: 'missing-person', rate: 20, periodStart: '2026-01', periodEnd: '2026-01' },
  ];
  return { projects, people, rules, entries, generatedAt: '2026-08-24T00:00:00.000Z' };
}

function createDashboardRouteHarness({
  role = 'admin',
  rbacPolicy = profilePolicy(),
  fixture = buildProfessionalProfileFixture(),
} = {}) {
  const app = express();
  const collectionReads = [];
  const writes = [];
  const docs = (items) => items.map((data) => ({ id: data.id || data.personId, data: () => data }));
  const byCollection = {
    projects: fixture.projects,
    partEntries: fixture.entries,
    persons: fixture.people,
    participation_rules: fixture.rules,
  };
  const db = {
    collection(path) {
      const collectionName = path.split('/').at(-1);
      return {
        get: async () => {
          collectionReads.push(path);
          return { docs: docs(byCollection[collectionName] || []) };
        },
        set: async (...args) => writes.push({ path, args }),
      };
    },
    doc(path) {
      return { set: async (...args) => writes.push({ path, args }) };
    },
  };
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: 'tenant-a', actorRole: role, actorId: 'actor-a' };
    next();
  });
  mountParticipationDashboardRoutes(app, {
    db,
    now: () => '2026-08-24T00:00:00.000Z',
    idempotencyService: {},
    rbacPolicy,
    professionalProfileCatalog: getProfessionalProfileCatalog(),
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: error.code, message: error.message });
  });
  return { app, collectionReads, writes };
}

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
    expect(result.filterOptions.settlementSystems).toEqual(expect.arrayContaining([{ value: 'NONE', label: '시스템 미사용', projectCount: 0 }]));
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
      label: 'e나라도움 (국고보조금통합관리시스템)',
      projectCount: 1,
    });
  });

  it('사업 등록 정산 시스템 전체를 등록 순서와 사업 수로 제공한다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [{
        ...secondProject,
        registrationRequirementsVersion: 2,
        basis: 'SUPPLY_AMOUNT',
      }],
    });

    expect(snapshot.filterOptions.settlementSystems).toEqual([
      { value: 'NONE', label: '시스템 미사용', projectCount: 0 },
      { value: 'E_NARA_DOUM', label: 'e나라도움 (국고보조금통합관리시스템)', projectCount: 1 },
      { value: 'BOTAEM_E', label: '보탬e(지방보조금관리시스템)', projectCount: 0 },
      { value: 'RCMS', label: 'RCMS (실시간연구비관리시스템)', projectCount: 0 },
      { value: 'EZBARO', label: '통합이지바로 (통합 Ez-plus)', projectCount: 0 },
      { value: 'SMTECH', label: 'SMTECH (중소기업기술개발사업종합관리시스템)', projectCount: 0 },
      { value: 'KOCCA_PMS', label: 'KOCCA PMS', projectCount: 0 },
      { value: 'NIPA', label: 'NIPA 사업관리시스템', projectCount: 0 },
      { value: 'IRIS', label: 'IRIS(범부처통합연구지원시스템)', projectCount: 0 },
      { value: 'OTHER', label: '기타', projectCount: 0 },
    ]);
  });

  it('관측된 레거시 정산 분류를 등록 카탈로그 뒤에 정렬하고 실제 사업 수를 센다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [
        { id: 'accountant-1', settlementSystem: 'ACCOUNTANT' },
        { id: 'private-1', settlementSystem: 'NONE' },
        { id: 'accountant-2', registrationRequirementsVersion: 2, basis: 'SUPPLY_AMOUNT', settlementSystem: 'ACCOUNTANT' },
        { id: 'private-2', settlementSystem: 'NONE' },
        { id: 'private-3', settlementSystem: 'NONE' },
      ],
    });

    expect(snapshot.filterOptions.settlementSystems.map(({ value }) => value)).toEqual([
      ...PROJECT_SETTLEMENT_SYSTEM_CODES,
      'ACCOUNTANT',
      'PRIVATE',
    ]);
    expect(snapshot.filterOptions.settlementSystems.slice(-2)).toEqual([
      { value: 'ACCOUNTANT', label: '회계사정산', projectCount: 2 },
      { value: 'PRIVATE', label: '민간사업', projectCount: 3 },
    ]);
  });

  it('사업 등록 카탈로그와 표시명을 클라이언트 계약과 동일하게 유지한다', () => {
    expect(PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES).toEqual(PROJECT_SETTLEMENT_SYSTEM_CODES);
    expect(PARTICIPATION_SETTLEMENT_SYSTEM_LABELS).toEqual(SETTLEMENT_SYSTEM_LABELS);
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

  it('저장 View는 선택 연도에 매칭되는 사업별 월 상태를 부모 합계와 함께 반환한다', () => {
    const projects = [
      { id: 'p-sheet', name: '시트 사업', clientOrg: 'KOICA', settlementSystem: 'E_NARA_DOUM' },
      { id: 'p-manual', name: '수기 사업', clientOrg: 'KOICA', settlementSystem: 'RCMS' },
      { id: 'p-out', name: '제외 사업', clientOrg: 'OTHER', settlementSystem: 'RCMS' },
      { id: 'p-old', name: '과거 사업', clientOrg: 'KOICA', settlementSystem: 'RCMS' },
    ];
    const snapshot = buildParticipationDashboardSnapshot({
      projects,
      people: [{ personId: 'person-1', name: '참여자' }],
      rules: [{
        id: 'koica', kind: 'USER_DEFINED', alias: 'KOICA 사업', clientOrgs: ['KOICA'],
        settlementSystems: ['E_NARA_DOUM', 'RCMS'],
      }],
      entries: [
        { id: 'sheet', source: 'PROJECT_TEAM_SYNC', projectId: 'p-sheet', personId: 'person-1', rate: 20, periodStart: '2026-01', periodEnd: '2026-03', monthlyRates: { '2026-01': 20, '2026-02': null, '2026-03': 0 } },
        { id: 'sheet-manual', source: 'MANUAL', projectId: 'p-sheet', personId: 'person-1', rate: 5, periodStart: '2026-01', periodEnd: '2026-03' },
        { id: 'manual', source: 'MANUAL', projectId: 'p-manual', personId: 'person-1', rate: 40, periodStart: '2026-01', periodEnd: '2026-03' },
        { id: 'out', source: 'MANUAL', projectId: 'p-out', personId: 'person-1', rate: 90, periodStart: '2026-01', periodEnd: '2026-03' },
        { id: 'old', source: 'MANUAL', projectId: 'p-old', personId: 'person-1', rate: 10, periodStart: '2025-01', periodEnd: '2025-12' },
      ],
    });

    const savedMember = selectParticipationDashboardYear(snapshot, '2026', 'koica').members[0];
    expect(savedMember.projectCount).toBe(2);
    expect(savedMember.projects.map(({ projectId }) => projectId)).toEqual(['p-manual', 'p-sheet']);
    expect(savedMember.projectLabel).toBe('수기 사업 · 시트 사업');
    expect(savedMember.months.slice(0, 3)).toEqual([
      { yearMonth: '2026-01', label: '1월', rate: 60, isConfirmed: true, hasMissing: false, isWarning: false },
      { yearMonth: '2026-02', label: '2월', rate: 40, isConfirmed: true, hasMissing: true, isWarning: false },
      { yearMonth: '2026-03', label: '3월', rate: 40, isConfirmed: true, hasMissing: false, isWarning: false },
    ]);
    expect(savedMember.projects.find(({ projectId }) => projectId === 'p-sheet').months.slice(0, 3)).toEqual([
      { yearMonth: '2026-01', label: '1월', rate: 20, isConfirmed: true, hasMissing: false, isWarning: false },
      { yearMonth: '2026-02', label: '2월', rate: 0, isConfirmed: false, hasMissing: true, isWarning: false },
      { yearMonth: '2026-03', label: '3월', rate: 0, isConfirmed: true, hasMissing: false, isWarning: false },
    ]);
    expect(savedMember.projects.map(({ projectId }) => projectId)).not.toContain('p-out');
    expect(savedMember.projects.map(({ projectId }) => projectId)).not.toContain('p-old');

    const allMember = selectParticipationDashboardYear(snapshot, '2026').members[0];
    expect(allMember.projects).toEqual([]);
    expect(allMember.projectCount).toBe(3);
  });

  it('같은 projectId의 여러 stint는 하나로 합치고 같은 이름의 다른 ID는 분리한다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [
        { id: 'p-one', name: '같은 이름', clientOrg: 'KOICA' },
        { id: 'p-two', name: '같은 이름', clientOrg: 'KOICA' },
      ],
      people: [{ personId: 'person-1', name: '참여자' }],
      rules: [{ id: 'koica', kind: 'USER_DEFINED', alias: 'KOICA', clientOrgs: ['KOICA'] }],
      entries: [
        { id: 'one-a', projectId: 'p-one', personId: 'person-1', rate: 10, periodStart: '2026-01', periodEnd: '2026-01' },
        { id: 'one-b', projectId: 'p-one', personId: 'person-1', rate: 20, periodStart: '2026-02', periodEnd: '2026-02' },
        { id: 'two', projectId: 'p-two', personId: 'person-1', rate: 30, periodStart: '2026-01', periodEnd: '2026-01' },
      ],
    });

    const member = selectParticipationDashboardYear(snapshot, '2026', 'koica').members[0];
    expect(member.projectCount).toBe(2);
    expect(member.projects.map(({ projectId }) => projectId)).toEqual(['p-one', 'p-two']);
    expect(member.projects[0].months.slice(0, 2).map(({ rate }) => rate)).toEqual([10, 20]);
  });

  it('동일 프로젝트 stint 입력 순서와 무관하게 이름과 월 키를 안정적으로 직렬화한다', () => {
    const common = {
      projects: [{ id: 'p-one', name: '프로젝트 원본명', clientOrg: 'KOICA' }],
      people: [{ personId: 'person-1', name: '참여자' }],
      rules: [{ id: 'koica', kind: 'USER_DEFINED', alias: 'KOICA', clientOrgs: ['KOICA'] }],
    };
    const entries = [
      { id: 'feb', projectId: 'p-one', projectShortName: '나 사업', personId: 'person-1', rate: 20, periodStart: '2026-02', periodEnd: '2026-02' },
      { id: 'jan', projectId: 'p-one', projectName: '가 사업', personId: 'person-1', rate: 10, periodStart: '2026-01', periodEnd: '2026-01' },
    ];
    const serializedProject = (orderedEntries) => buildParticipationDashboardSnapshot({
      ...common,
      entries: orderedEntries,
    }).rules.find(({ id }) => id === 'koica').members[0].projects[0];

    const forward = serializedProject(entries);
    const reverse = serializedProject([...entries].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.projectName).toBe('가 사업');
    expect(Object.keys(forward.monthlyRates)).toEqual(['2026-01', '2026-02']);
  });

  it('일부 stint에만 entry 이름이 있어도 canonical 사업명보다 우선한다', () => {
    const common = {
      projects: [{ id: 'p-one', name: '가 원본명', clientOrg: 'KOICA' }],
      people: [{ personId: 'person-1', name: '참여자' }],
      rules: [{ id: 'koica', kind: 'USER_DEFINED', alias: 'KOICA', clientOrgs: ['KOICA'] }],
    };
    const entries = [
      { id: 'labeled', projectId: 'p-one', projectShortName: '나 사업', personId: 'person-1', rate: 10, periodStart: '2026-01', periodEnd: '2026-01' },
      { id: 'unlabeled', projectId: 'p-one', personId: 'person-1', rate: 20, periodStart: '2026-02', periodEnd: '2026-02' },
    ];
    const serializedProject = (orderedEntries) => buildParticipationDashboardSnapshot({
      ...common,
      entries: orderedEntries,
    }).rules.find(({ id }) => id === 'koica').members[0].projects[0];

    const forward = serializedProject(entries);
    const reverse = serializedProject([...entries].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.projectName).toBe('나 사업');
  });

  it('전월 미입력 사업과 전월 명시적 0 사업도 선택 연도 사업으로 센다', () => {
    const snapshot = buildParticipationDashboardSnapshot({
      projects: [{ id: 'missing', name: '빈 사업' }, { id: 'zero', name: '0 사업' }],
      people: [{ personId: 'person-1', name: '참여자' }],
      rules: [{ id: 'both', kind: 'USER_DEFINED', alias: '둘 다', settlementSystems: [] }],
      entries: [
        { id: 'missing-entry', source: 'PROJECT_TEAM_SYNC', projectId: 'missing', personId: 'person-1', periodStart: '2026-01', periodEnd: '2026-12', monthlyRates: {} },
        { id: 'zero-entry', source: 'PROJECT_TEAM_SYNC', projectId: 'zero', personId: 'person-1', periodStart: '2026-01', periodEnd: '2026-12', monthlyRates: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`2026-${String(index + 1).padStart(2, '0')}`, 0])) },
      ],
    });

    const member = selectParticipationDashboardYear(snapshot, '2026', 'both').members[0];
    expect(member.projectCount).toBe(2);
    expect(member.projects.map(({ projectId }) => projectId)).toEqual(['zero', 'missing']);
    expect(member.projects[0].months.every(({ isConfirmed, hasMissing }) => isConfirmed && !hasMissing)).toBe(true);
    expect(member.projects[1].months.every(({ isConfirmed, hasMissing }) => !isConfirmed && hasMissing)).toBe(true);
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
  it('고정 4-read 로 참여율만 돌려주고 인사정보 원문은 흘리지 않는다', async () => {
    // 2026-08-27 보람: 학력·어학·자격 컬럼과 필터는 인력 명부(People)로 옮겼다.
    // 참여율 응답에는 권한과 무관하게 인사정보가 실리지 않는다.
    const harness = createDashboardRouteHarness();
    const response = await request(harness.app)
      .get('/api/v1/participation-dashboard')
      .query({ year: '2026', ruleId: 'koica' })
      .expect(200);

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).not.toHaveProperty('professionalProfileAccess');
    expect(response.body).not.toHaveProperty('profileFilterOptions');
    expect(response.body).not.toHaveProperty('selectedProfileFilters');
    expect(response.body.members.every((member) => !Object.hasOwn(member, 'profileSummary'))).toBe(true);
    expect(harness.collectionReads).toEqual([
      'orgs/tenant-a/projects',
      'orgs/tenant-a/partEntries',
      'orgs/tenant-a/persons',
      'orgs/tenant-a/participation_rules',
    ]);
    expect(harness.writes).toEqual([]);

    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      '"email"', '"uid"', '"note"', 'educationRecords', 'testedAt', 'PMP', 'TOEIC 920',
      'PROFILE_FIXTURE_SECRET', 'PERSON_NOTE_SECRET', 'secret-uid-p1', 'secret-p1@example.com',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('권한이 낮은 역할도 같은 참여율 응답을 받는다 — 가려야 할 인사정보 자체가 없다', async () => {
    const harness = createDashboardRouteHarness({ role: 'viewer' });
    const response = await request(harness.app)
      .get('/api/v1/participation-dashboard?year=2026&ruleId=koica')
      .expect(200);
    expect(response.body.members.every((member) => !Object.hasOwn(member, 'profileSummary'))).toBe(true);
  });

  it('production BFF 조립에서도 참여율만 돌려준다', async () => {
    const fixture = buildProfessionalProfileFixture();
    const byCollection = {
      projects: fixture.projects,
      partEntries: fixture.entries,
      persons: fixture.people,
      participation_rules: fixture.rules,
    };
    const missingSnapshot = { exists: false, data: () => undefined };
    const db = {
      collection(path) {
        const items = byCollection[path.split('/').at(-1)] || [];
        return {
          get: async () => ({
            docs: items.map((data) => ({ id: data.id || data.personId, data: () => data })),
          }),
        };
      },
      doc: () => ({ get: async () => missingSnapshot, set: async () => {} }),
      runTransaction: async (callback) => callback({
        get: async () => missingSnapshot,
        set: () => {},
        create: () => {},
        update: () => {},
      }),
    };
    const app = createBffApp({
      projectId: 'demo-participation-profile',
      db,
      authMode: 'headers',
      tokenVerifier: async () => ({}),
      authAdminService: {},
      piiProtector: { encryptText: async (value) => ({ ciphertext: `enc:${value}` }) },
      rbacPolicy: profilePolicy({ readers: ['pm'] }),
      professionalProfileCatalog: getProfessionalProfileCatalog(),
      env: {
        BFF_DEPLOY_ENV: 'local',
        NODE_ENV: 'test',
        BFF_AUTH_MODE: 'headers',
        BFF_SCHEDULER_OWNER: 'disabled',
      },
    });

    const response = await request(app)
      .get('/api/v1/participation-dashboard')
      .query({ year: '2026', ruleId: 'all' })
      .set({
        'x-tenant-id': 'tenant-a',
        'x-actor-id': 'actor-a',
        'x-actor-role': 'pm',
      })
      .expect(200);

    // 인사정보는 응답에 실리지 않는다 - 사람을 고르는 일은 인력 명부에서 한다.
    expect(response.body).not.toHaveProperty('professionalProfileAccess');
    expect(response.body.members.every((member) => !Object.hasOwn(member, 'profileSummary'))).toBe(true);
  });

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
    const zeroProjectResponse = await request(app).post('/api/v1/participation-dashboard/rules').set('Idempotency-Key', 'zero-project-key').send({ alias: 'RCMS 예정 사업', clientOrgs: [], settlementSystems: ['RCMS'] }).expect(200);
    expect(saved.get(`orgs/mysc/participation_rules/${zeroProjectResponse.body.id}`)).toMatchObject({ alias: 'RCMS 예정 사업', clientOrgs: [], settlementSystems: ['RCMS'] });
    const savedCount = saved.size;
    const unknownResponse = await request(app).post('/api/v1/participation-dashboard/rules').set('Idempotency-Key', 'unknown-platform-key').send({ alias: '알 수 없는 플랫폼', clientOrgs: [], settlementSystems: ['UNKNOWN_PLATFORM'] }).expect(422);
    expect(unknownResponse.body.code).toBe('invalid_participation_rule_filter');
    expect(saved.size).toBe(savedCount);
  });
});
