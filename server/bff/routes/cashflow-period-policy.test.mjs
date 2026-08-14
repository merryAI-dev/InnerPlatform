import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { assertCashflowMonthWritable } from '../cashflow-month-state.mjs';
import { mountCashflowPeriodPolicyRoutes } from './cashflow-period-policy.mjs';

function createHarness({
  role = 'admin',
  actorId = 'admin-uid',
  actorEmail = 'admin@example.com',
  documents = {},
  failingCollections = [],
  beforeTransaction,
} = {}) {
  const store = new Map(Object.entries(documents));
  const audit = [];
  const idempotencyRecords = new Map();
  const failing = new Set(failingCollections);

  function directCollectionDocs(path) {
    if (failing.has(path)) throw new Error(`store unavailable: ${path}`);
    const prefix = `${path}/`;
    return [...store.entries()]
      .filter(([candidate]) => candidate.startsWith(prefix) && !candidate.slice(prefix.length).includes('/'))
      .map(([candidate, data]) => ({
        id: candidate.slice(prefix.length),
        exists: true,
        data: () => data,
      }));
  }

  function createQuery(path, filters = [], limitValue = null) {
    return {
      __kind: 'query',
      where(field, operator, value) {
        if (operator !== '==') throw new Error(`unsupported operator: ${operator}`);
        return createQuery(path, [...filters, { field, value }], limitValue);
      },
      limit(value) {
        return createQuery(path, filters, value);
      },
      async get() {
        let docs = directCollectionDocs(path).filter((doc) => {
          const data = doc.data() || {};
          return filters.every((filter) => data[filter.field] === filter.value);
        });
        if (Number.isSafeInteger(limitValue)) docs = docs.slice(0, limitValue);
        return { docs, size: docs.length };
      },
    };
  }

  const db = {
    collection: (path) => createQuery(path),
    doc: (path) => ({
      __kind: 'doc',
      __path: path,
      async get() {
        return {
          id: path.split('/').at(-1),
          exists: store.has(path),
          data: () => store.get(path),
        };
      },
    }),
    async runTransaction(handler) {
      if (beforeTransaction) await beforeTransaction(store);
      return handler({
        get: (ref) => ref.get(),
        set(ref, value, options) {
          const current = store.get(ref.__path) || {};
          store.set(ref.__path, options?.merge ? { ...current, ...value } : value);
        },
        create(ref, value) {
          if (store.has(ref.__path)) throw new Error(`already exists: ${ref.__path}`);
          store.set(ref.__path, value);
        },
        delete(ref) {
          store.delete(ref.__path);
        },
      });
    },
  };

  const idempotencyService = {
    async begin({ idempotencyKey, method, path }) {
      const key = `${method}:${path}:${idempotencyKey}`;
      const record = idempotencyRecords.get(key);
      if (record) return { mode: 'replay', ...record };
      return { mode: 'new', requestFingerprint: key };
    },
    async complete({ requestFingerprint, responseStatus, responseBody }) {
      idempotencyRecords.set(requestFingerprint, { status: responseStatus, body: responseBody });
    },
    async fail() {},
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId,
      actorRole: role,
      actorEmail,
      requestId: req.header('x-request-id') || 'request-1',
      idempotencyKey: req.header('x-idempotency-key') || 'idempotency-1',
    };
    next();
  });
  mountCashflowPeriodPolicyRoutes(app, {
    db,
    now: () => '2026-08-14T01:02:03.000Z',
    idempotencyService,
    auditChainService: {
      async appendManyInTransaction(_tx, entries) {
        audit.push(...entries);
        return entries.map((_entry, index) => ({ id: `audit-${index + 1}` }));
      },
    },
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ error: error.code || 'internal_error', message: error.message });
  });

  return { app, store, audit };
}

const completeDocuments = {
  'orgs/tenant-a/projects/project-a': {
    id: 'project-a',
    name: '2026 CTS3',
    status: '진행 중',
    version: 7,
    executiveApproverId: 'head-uid',
    untouched: 'preserve-me',
  },
  'orgs/tenant-a/cashflow_cumulative_close_heads/project-a': {
    contractVersion: 'cashflow-cumulative-close-v2',
    tenantId: 'tenant-a',
    projectId: 'project-a',
    status: 'CLOSED',
    fromMonth: '2023-01',
    closedThrough: '2026-07',
    revision: 3,
    rootHash: `sha256:${'a'.repeat(64)}`,
    closedAt: '2026-08-11T10:00:00.000Z',
    closedByUid: 'head-uid',
  },
  'orgs/tenant-a/monthly_close_versions/project-a-2026-06-r1': {
    projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1,
    closedAt: '2026-07-10T01:00:00.000Z', closedByUid: 'head-uid', snapshot: { amount: 999 },
  },
  'orgs/tenant-a/monthly_close_versions/project-a-2026-07-r2': {
    projectId: 'project-a', yearMonth: '2026-07', status: 'CLOSED', revision: 2,
    closedAt: '2026-08-11T10:00:00.000Z', closedByUid: 'head-uid', snapshot: { amount: 123 },
  },
  'orgs/tenant-a/cashflow_sheet_mirrors/project-a': {
    projectId: 'project-a',
    weeklyYear: 2026,
    status: 'FRESH',
    sheetContract: { weeklyYear: 2026, annualYears: [2024, 2025] },
    sourceRevision: 'sha256:source',
    appliedSourceRevision: 'sha256:source',
    targetRevisionAtFetch: 'sha256:target',
    appliedTargetRevision: 'sha256:target',
    capturedAt: '2026-08-13T23:00:00.000Z',
    sheetFacts: {
      projection: 999_999_999,
      weeklyCalculationChecks: [{
        mode: 'actual',
        yearMonth: '2026-08',
        weekNo: 2,
        reported: {
          openingBalance: 90,
          depositTotal: 140,
          withdrawalTotal: 30,
          balance: 100,
        },
        sourceCells: {
          openingBalance: 'AG56',
          depositTotal: 'AG64',
          withdrawalTotal: 'AG73',
          balance: 'AG74',
        },
      }, {
        mode: 'actual',
        yearMonth: '2026-08',
        weekNo: 3,
        reported: {
          openingBalance: 100,
          depositTotal: 180,
          withdrawalTotal: 50,
          balance: 230,
        },
        sourceCells: {
          openingBalance: 'AH56',
          depositTotal: 'AH64',
          withdrawalTotal: 'AH73',
          balance: 'AH74',
        },
      }],
    },
  },
  'orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-08-w2': {
    projectId: 'project-a',
    yearMonth: '2026-08',
    weekNo: 2,
    status: 'LOCKED',
    sourceRevision: 'sha256:baseline-source',
    targetRevision: 'sha256:baseline-target',
    snapshot: {
      forecastBaseline: {
        contractVersion: 'cashflow-forecast-baseline-v1',
        status: 'AVAILABLE',
        capturedFromYearMonth: '2026-08',
        capturedFromWeekNo: 2,
        yearMonth: '2026-08',
        weekNo: 3,
        capturedAt: '2026-08-09T13:00:00.000Z',
        capturedByUid: 'head-uid',
        sourceRevision: 'sha256:baseline-source',
        targetRevision: 'sha256:baseline-target',
        reported: {
          openingBalance: 100,
          depositTotal: 200,
          withdrawalTotal: 40,
          balance: 260,
        },
        sourceCells: {
          openingBalance: 'AH33',
          depositTotal: 'AH41',
          withdrawalTotal: 'AH50',
          balance: 'AH51',
        },
      },
    },
  },
  'orgs/tenant-a/cashflow_month_amendments/amendment-a': {
    id: 'amendment-a',
    projectId: 'project-a',
    yearMonth: '2026-07',
    closeRevision: 2,
    resultingCloseRevision: 3,
    closeSnapshotHash: 'sha256:closed-july',
    sourceRevision: 'sha256:source-before',
    targetRevision: 'sha256:target-before',
    resultingTargetRevision: 'sha256:target-after',
    reason: '7월 결산 후 직접사업비 정정',
    actorUid: 'admin-uid',
    actorName: '변민욱(보람)',
    createdAt: '2026-08-13T10:12:00.000Z',
  },
  'orgs/tenant-a/persons/person-head': {
    personId: 'person-head', uid: 'head-uid', name: '고인효', nickname: '베리',
  },
  'orgs/tenant-a/persons/person-admin': {
    personId: 'person-admin', uid: 'admin-uid', name: '변민욱', nickname: '보람',
  },
  'orgs/tenant-a/persons/person-next-head': {
    personId: 'person-next-head', uid: 'next-head-uid', name: '김선미', nickname: '해니',
  },
  'orgs/tenant-a/persons/person-inactive-admin': {
    personId: 'person-inactive-admin', uid: 'inactive-admin-uid', name: '휴직', nickname: '관리자',
  },
  'orgs/tenant-a/members/admin-uid': {
    uid: 'admin-uid', role: 'admin', status: 'ACTIVE', email: 'admin@example.com',
  },
  'orgs/tenant-a/members/head-uid': {
    uid: 'head-uid', role: 'viewer', status: 'ACTIVE',
  },
  'orgs/tenant-a/members/next-head-uid': {
    uid: 'next-head-uid', role: 'viewer', status: 'ACTIVE',
  },
  'orgs/tenant-a/members/inactive-admin-uid': {
    uid: 'inactive-admin-uid', role: 'admin', status: 'INACTIVE',
  },
  'orgs/tenant-a/members/bootstrap-email-only': {
    uid: 'not-admin-uid', role: 'viewer', status: 'ACTIVE', email: 'mwbyun1220@mysc.co.kr',
  },
};

const RECOVERY_ROOT_HASH = `sha256:${'a'.repeat(64)}`;
const RECOVERY_SNAPSHOT_HASH = `sha256:${'b'.repeat(64)}`;
const RECOVERY_SOURCE_REVISION = `sha256:${'c'.repeat(64)}`;

function strictRecoveryDocuments({ head = 'missing', complete = true, includeProjectB = false } = {}) {
  const monthShards = [];
  for (let cursor = new Date(Date.UTC(2023, 0, 1)), index = 0;
    cursor <= new Date(Date.UTC(2026, 6, 1));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1), index += 1) {
    monthShards.push({
      yearMonth: cursor.toISOString().slice(0, 7),
      shardHash: `sha256:${(index % 16).toString(16).repeat(64)}`,
    });
  }
  const snapshot = {
    schemaVersion: 2,
    contractVersion: 'cashflow-cumulative-close-v2',
    projectId: 'project-a',
    yearMonth: '2026-08',
    requestId: 'project-a-2026-08',
    requestRevision: 1,
    manifestHash: RECOVERY_ROOT_HASH,
    rootHash: RECOVERY_ROOT_HASH,
    headRevision: 4,
    approvalId: 'approval-project-a',
    operationId: 'operation-project-a',
    monthShards,
    closedAt: '2026-08-11T10:00:00.000Z',
    closedByUid: 'head-uid',
  };
  const canonicalHead = {
    contractVersion: 'cashflow-cumulative-close-v2',
    tenantId: 'tenant-a',
    projectId: 'project-a',
    status: 'CLOSED',
    fromMonth: '2023-01',
    closedThrough: '2026-07',
    settlementMonth: '2026-08',
    rootHash: RECOVERY_ROOT_HASH,
    revision: 4,
    requestId: 'project-a-2026-08',
    requestRevision: 1,
    approvalId: 'approval-project-a',
    operationId: 'operation-project-a',
    closedAt: snapshot.closedAt,
    closedByUid: snapshot.closedByUid,
  };
  const documents = {
    ...completeDocuments,
    'orgs/tenant-a/monthly_closes/project-a-2026-08': {
      contractVersion: 'cashflow-month-close-v1', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-08', status: 'CLOSED', revision: 1,
      latestVersionId: 'project-a-2026-08-r1', snapshotHash: RECOVERY_SNAPSHOT_HASH,
      snapshot, closedAt: snapshot.closedAt, closedByUid: snapshot.closedByUid,
    },
    'orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1': {
      contractVersion: 'cashflow-month-close-v1', tenantId: 'tenant-a', projectId: 'project-a',
      yearMonth: '2026-08', status: 'CLOSED', revision: 1,
      snapshotHash: RECOVERY_SNAPSHOT_HASH,
      sourceRevision: complete ? RECOVERY_SOURCE_REVISION : null,
      snapshot, closedAt: snapshot.closedAt, closedByUid: snapshot.closedByUid,
    },
    'orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08': {
      contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'tenant-a', projectId: 'project-a',
      requestId: 'project-a-2026-08', yearMonth: '2026-08',
      fromMonth: '2023-01', throughMonth: '2026-07',
      scope: {
        contractVersion: 'cashflow-cumulative-close-v2', fromMonth: '2023-01', throughMonth: '2026-07',
      },
      status: 'APPROVED', revision: 2, manifestHash: RECOVERY_ROOT_HASH,
      monthCount: monthShards.length, approvalId: snapshot.approvalId, operationId: snapshot.operationId,
    },
  };
  delete documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'];
  if (head === 'valid') {
    documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = canonicalHead;
  } else if (head === 'invalid') {
    documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'] = {
      ...canonicalHead,
      closedThrough: '2026-06',
      revision: 99,
      legacyField: 'audit-copy-required',
    };
  }
  if (includeProjectB) {
    documents['orgs/tenant-a/projects/project-b'] = {
      id: 'project-b', name: '독립 프로젝트', status: '진행 중', version: 1,
    };
  }
  return { documents, canonicalHead };
}

describe('AXR 현금흐름 기간·마감 정책 BFF', () => {
  it('runtime member.role=admin을 SSOT로 사용해 stale claim role에 의존하지 않는다', async () => {
    const { app } = createHarness({ role: 'finance', documents: completeDocuments });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
  });

  it('요청 claim이 admin이어도 runtime member.role이 admin이 아니면 거절한다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/members/admin-uid': {
        uid: 'admin-uid', role: 'viewer', status: 'ACTIVE', email: 'mwbyun1220@mysc.co.kr',
      },
    };
    const { app } = createHarness({ role: 'admin', documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('runtime_superadmin_required');
  });

  it('authority, latest run, sheet revision, People UID 조직장과 runtime admin을 표시 문자열까지 조합한다', async () => {
    const { app } = createHarness({ documents: completeDocuments });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.generatedAtLabel).toBe('2026-08-14T01:02:03.000Z');
    expect(response.body).toMatchObject({
      status: 'OK',
      statusLabel: '정상',
      tone: 'positive',
      superadmins: {
        status: 'AVAILABLE',
        tone: 'positive',
        items: [{ uid: 'admin-uid', personId: 'person-admin', displayName: '변민욱(보람)' }],
      },
      executiveApproverCandidates: {
        status: 'AVAILABLE',
        items: expect.arrayContaining([
          { uid: 'head-uid', personId: 'person-head', displayName: '고인효(베리)' },
          { uid: 'next-head-uid', personId: 'person-next-head', displayName: '김선미(해니)' },
        ]),
      },
      amendments: {
        status: 'AVAILABLE',
        statusLabel: '닫힌 월 수정 이력 1건',
        rows: [{
          id: 'amendment-a',
          projectId: 'project-a',
          projectName: '2026 CTS3',
          yearMonth: '2026-07',
          yearMonthLabel: '2026년 7월',
          reason: '7월 결산 후 직접사업비 정정',
          actorUid: 'admin-uid',
          actorName: '변민욱(보람)',
          closeRevision: 2,
          closeRevisionLabel: '리비전 2',
          resultingCloseRevision: 3,
          resultingCloseRevisionLabel: '리비전 3',
          closeSnapshotHash: 'sha256:closed-july',
          sourceRevision: 'sha256:source-before',
          targetRevision: 'sha256:target-before',
          resultingTargetRevision: 'sha256:target-after',
          createdAt: '2026-08-13T10:12:00.000Z',
          createdAtLabel: '2026-08-13T10:12:00.000Z',
        }],
      },
      items: [{
        project: { id: 'project-a', name: '2026 CTS3', status: '진행 중' },
        authority: {
          status: 'CLOSED', tone: 'positive', closedThrough: '2026-07', closedThroughLabel: '2026년 7월까지 마감',
          revision: 3, revisionLabel: '리비전 3',
        },
        latestRun: {
          status: 'CLOSED', yearMonth: '2026-07', yearMonthLabel: '2026년 7월',
          revision: 2, closedByUid: 'head-uid', closedByLabel: '고인효(베리)',
        },
        sheet: {
          status: 'FRESH', weeklyYear: 2026, weeklyYearLabel: '2026년 주차형',
          annualYears: [2024, 2025], annualYearsLabel: '2024년, 2025년 연간형',
          revisionStatus: 'ALIGNED', revisionStatusLabel: 'Source/target 리비전 일치', revisionTone: 'positive',
        },
        executiveApprover: {
          status: 'LINKED', uid: 'head-uid', personId: 'person-head', displayName: '고인효(베리)',
          expectedVersion: 7, expectedVersionLabel: '프로젝트 리비전 7',
        },
        forecastVariance: {
          status: 'AVAILABLE',
          eligibleCount: 1,
          coverageCount: 1,
          coverageLabel: '비교 가능 1/1주차',
          rows: [{
            status: 'AVAILABLE',
            yearMonth: '2026-08',
            weekNo: 3,
            variance: {
              openingBalance: 0,
              depositTotal: 20,
              withdrawalTotal: -10,
              balance: 30,
            },
          }],
        },
      }],
      forecastVariance: {
        status: 'AVAILABLE',
        complete: false,
        eligibleCount: 1,
        coverageCount: 1,
        totals: {
          complete: false,
          variance: {
            openingBalance: 0,
            depositTotal: 20,
            withdrawalTotal: -10,
            balance: 30,
          },
        },
      },
    });
    expect(response.body.superadmins.items).toHaveLength(1);
    expect(response.body.items[0].forecastVariance.rows[0].actual.sourceCells.openingBalance)
      .toBe('AG74');
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('999999999');
    expect(serialized).not.toContain('"snapshot"');
    expect(serialized).not.toContain('weeklyCalculationChecks');
  });

  it('canonical member 문서만 runtime superadmin과 조직장 후보로 읽는다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/persons/person-legacy-admin': {
        personId: 'person-legacy-admin', uid: 'legacy-admin-uid', name: '레거시 관리자',
      },
      'orgs/tenant-a/members/legacy-admin-document': {
        uid: 'legacy-admin-uid', role: 'admin', status: 'ACTIVE',
      },
      'orgs/tenant-a/persons/person-missing-uid-admin': {
        personId: 'person-missing-uid-admin', uid: 'missing-uid-admin', name: 'UID 누락 관리자',
      },
      'orgs/tenant-a/members/missing-uid-admin': {
        role: 'admin', status: 'ACTIVE',
      },
    };
    const { app } = createHarness({ documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const superadminUids = response.body.superadmins.items.map((item) => item.uid);
    const candidateUids = response.body.executiveApproverCandidates.items.map((item) => item.uid);

    expect(response.status).toBe(200);
    expect(superadminUids).not.toContain('legacy-admin-uid');
    expect(candidateUids).not.toContain('legacy-admin-uid');
    expect(candidateUids).not.toContain('missing-uid-admin');
  });

  it('People가 연결돼도 canonical member 문서가 없으면 조직장을 INACTIVE로 표시한다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/members/legacy-head-document': {
        uid: 'head-uid', role: 'viewer', status: 'ACTIVE',
      },
    };
    delete documents['orgs/tenant-a/members/head-uid'];
    const { app } = createHarness({ documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PARTIAL');
    expect(response.body.items[0].executiveApprover).toMatchObject({
      status: 'INACTIVE', uid: 'head-uid', personId: 'person-head',
    });
    expect(response.body.executiveApproverCandidates.items.map((item) => item.uid))
      .not.toContain('head-uid');
    expect(response.body.items[0].issues.map((entry) => entry.code))
      .toContain('EXECUTIVE_APPROVER_MEMBER_INACTIVE');
  });

  it('canonical member가 있어도 People UID가 없으면 조직장을 UNLINKED로 표시한다', async () => {
    const documents = { ...completeDocuments };
    delete documents['orgs/tenant-a/persons/person-head'];
    const { app } = createHarness({ documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PARTIAL');
    expect(response.body.items[0].executiveApprover).toMatchObject({
      status: 'UNLINKED', uid: 'head-uid', personId: null,
    });
    expect(response.body.items[0].issues.map((entry) => entry.code))
      .toContain('EXECUTIVE_APPROVER_PEOPLE_UID_UNLINKED');
  });

  it('source와 target revision이 모두 있고 각각 일치할 때만 ALIGNED로 판정한다', async () => {
    const targetDriftDocuments = {
      ...completeDocuments,
      'orgs/tenant-a/cashflow_sheet_mirrors/project-a': {
        ...completeDocuments['orgs/tenant-a/cashflow_sheet_mirrors/project-a'],
        appliedTargetRevision: 'sha256:other-target',
      },
    };
    const drift = createHarness({ documents: targetDriftDocuments });
    const driftResponse = await request(drift.app).get('/api/v1/admin/cashflow-period-policy');

    expect(driftResponse.status).toBe(200);
    expect(driftResponse.body.items[0].sheet).toMatchObject({
      revisionStatus: 'TARGET_DRIFT',
      revisionStatusLabel: '대상·반영 대상 리비전 불일치',
    });
    expect(driftResponse.body.items[0].issues.map((entry) => entry.code))
      .toContain('SHEET_TARGET_REVISION_DRIFT');

    const targetMissingDocuments = {
      ...completeDocuments,
      'orgs/tenant-a/cashflow_sheet_mirrors/project-a': {
        ...completeDocuments['orgs/tenant-a/cashflow_sheet_mirrors/project-a'],
        targetRevisionAtFetch: null,
      },
    };
    const missing = createHarness({ documents: targetMissingDocuments });
    const missingResponse = await request(missing.app).get('/api/v1/admin/cashflow-period-policy');

    expect(missingResponse.status).toBe(200);
    expect(missingResponse.body.items[0].sheet).toMatchObject({
      revisionStatus: 'TARGET_MISSING',
      revisionStatusLabel: '대상 리비전 없음',
    });
    expect(missingResponse.body.items[0].issues.map((entry) => entry.code))
      .toContain('SHEET_TARGET_REVISION_MISSING');
  });

  it('개별 저장소 장애를 숨기지 않고 PARTIAL/UNAVAILABLE issue로 반환한다', async () => {
    const { app } = createHarness({
      documents: completeDocuments,
      failingCollections: [
        'orgs/tenant-a/cashflow_sheet_mirrors',
        'orgs/tenant-a/monthly_close_versions',
        'orgs/tenant-a/cashflow_weekly_update_completions',
        'orgs/tenant-a/cashflow_month_amendments',
      ],
    });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PARTIAL');
    expect(response.body.items[0].sheet.status).toBe('UNAVAILABLE');
    expect(response.body.items[0].latestRun.status).toBe('UNAVAILABLE');
    expect(response.body.items[0].forecastVariance.status).toBe('UNAVAILABLE');
    expect(response.body.amendments).toMatchObject({
      status: 'UNAVAILABLE',
      statusLabel: '닫힌 월 수정 이력 조회 불가',
      rows: [],
    });
    expect(response.body.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SHEET_MIRROR_STORE_UNAVAILABLE',
      'MONTHLY_CLOSE_VERSION_STORE_UNAVAILABLE',
      'WEEKLY_COMPLETION_STORE_UNAVAILABLE',
      'CASHFLOW_MONTH_AMENDMENT_STORE_UNAVAILABLE',
    ]));
    const unavailableIssues = response.body.issues.filter((issue) => issue.code.endsWith('_STORE_UNAVAILABLE'));
    expect(unavailableIssues.every((issue) => issue.detail
      === '현금흐름 정책 정보를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.')).toBe(true);
    expect(JSON.stringify(response.body.issues)).not.toContain('store unavailable:');
  });

  it('CLOSED run이 있어도 cumulative head가 없으면 closedThrough를 추론하지 않는다', async () => {
    const documents = { ...completeDocuments };
    delete documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'];
    const { app } = createHarness({ documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.items[0].authority).toMatchObject({
      status: 'MISSING', closedThrough: null, closedThroughLabel: '누적 마감 없음',
    });
    expect(response.body.items[0].latestRun.status).toBe('CLOSED');
    expect(response.body.items[0].issues.map((issue) => issue.code)).toContain('LATEST_RUN_WITHOUT_CUMULATIVE_HEAD');
  });

  it.each([
    ['rootHash', { rootHash: 'sha256:broken' }],
    ['projectId', { projectId: 'different-project' }],
  ])('존재하는 cumulative head의 %s가 공통 계약을 위반하면 CLOSED/OK로 분류하지 않는다', async (_field, patch) => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-a': {
        ...completeDocuments['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'],
        ...patch,
      },
    };
    const { app } = createHarness({ documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('PARTIAL');
    expect(response.body.items[0].authority).toMatchObject({
      status: 'INVALID', closedThrough: null, revision: null, rootHash: null,
    });
    expect(response.body.items[0].issues.map((entry) => entry.code))
      .toContain('CUMULATIVE_CLOSE_HEAD_CONTRACT_INVALID');
  });

  it('조직장 변경은 runtime member.role=admin 전용이다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/members/admin-uid': {
        uid: 'admin-uid', role: 'viewer', status: 'ACTIVE',
      },
    };
    const { app } = createHarness({ role: 'admin', documents });
    const response = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-1')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('runtime_superadmin_required');
  });

  it('조직장 변경 사유가 없으면 쓰기와 audit 전에 거절한다', async () => {
    const { app, store, audit } = createHarness({ documents: completeDocuments });
    const before = { ...store.get('orgs/tenant-a/projects/project-a') };
    const response = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-missing-reason')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('cashflow_executive_approver_payload_invalid');
    expect(store.get('orgs/tenant-a/projects/project-a')).toEqual(before);
    expect(audit).toHaveLength(0);
  });

  it('People UID와 active member를 검증하고 project 한 필드군만 transaction으로 변경하며 audit을 한 번 누적한다', async () => {
    const { app, store, audit } = createHarness({ documents: completeDocuments });
    const first = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-1')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });
    const replay = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-1')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      projectId: 'project-a',
      executiveApprover: {
        status: 'LINKED', uid: 'next-head-uid', personId: 'person-next-head', displayName: '김선미(해니)',
        expectedVersion: 8,
      },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(store.get('orgs/tenant-a/projects/project-a')).toMatchObject({
      id: 'project-a', name: '2026 CTS3', untouched: 'preserve-me',
      executiveApproverId: 'next-head-uid', version: 8,
    });
    expect(store.get('orgs/tenant-a/projects/project-a')).not.toHaveProperty('executiveApproverName');
    expect(store.get('orgs/tenant-a/projects/project-a')).not.toHaveProperty('executiveApproverEmail');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityType: 'project', entityId: 'project-a', action: 'EXECUTIVE_APPROVER_CHANGE',
      metadata: { previousApproverUid: 'head-uid', nextApproverUid: 'next-head-uid', reason: '조직 개편' },
    });
  });

  it('100개 과거 요청 뒤의 101번째 active 요청도 GET/PATCH 모두 조직장 변경 잠금으로 판정한다', async () => {
    const historicalRequests = Object.fromEntries(Array.from({ length: 100 }, (_value, index) => [
      `orgs/tenant-a/cashflow_month_close_requests/project-a-history-${String(index).padStart(3, '0')}`,
      { projectId: 'project-a', status: 'APPROVED' },
    ]));
    const documents = {
      ...completeDocuments,
      ...historicalRequests,
      'orgs/tenant-a/cashflow_month_close_requests/project-a-current': {
        projectId: 'project-a', status: 'PENDING',
      },
    };
    const { app, store, audit } = createHarness({ documents });
    const before = structuredClone(store.get('orgs/tenant-a/projects/project-a'));

    const read = await request(app).get('/api/v1/admin/cashflow-period-policy').expect(200);
    const response = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-after-100-history')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });

    expect(read.body.items[0].executiveApprover.changeAction).toMatchObject({
      enabled: false,
      status: 'LOCKED',
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('cashflow_executive_approver_locked');
    expect(store.get('orgs/tenant-a/projects/project-a')).toEqual(before);
    expect(audit).toHaveLength(0);
  });

  it('조직장 변경 actor가 정확히 한 People UID에 연결되지 않으면 transaction에서 쓰기와 audit을 모두 차단한다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/persons/person-admin-duplicate': {
        personId: 'person-admin-duplicate', uid: 'admin-uid', name: '중복 관리자', nickname: '중복',
      },
    };
    const { app, store, audit } = createHarness({ documents });
    const before = structuredClone(store.get('orgs/tenant-a/projects/project-a'));

    const response = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-ambiguous-actor')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('runtime_superadmin_required');
    expect(store.get('orgs/tenant-a/projects/project-a')).toEqual(before);
    expect(audit).toHaveLength(0);
  });

  it('People 명부에 UID가 없으면 이름이나 이메일로 대신 연결하지 않는다', async () => {
    const documents = { ...completeDocuments };
    delete documents['orgs/tenant-a/persons/person-next-head'];
    documents['orgs/tenant-a/persons/same-name-only'] = {
      personId: 'same-name-only', uid: null, name: '김선미', nickname: '해니', email: 'next@example.com',
    };
    const { app } = createHarness({ documents });
    const response = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-2')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('cashflow_executive_approver_people_uid_unlinked');
  });

  it('중복 People UID와 stale project version을 각각 차단한다', async () => {
    const duplicateDocuments = {
      ...completeDocuments,
      'orgs/tenant-a/persons/person-next-head-duplicate': {
        personId: 'person-next-head-duplicate', uid: 'next-head-uid', name: '동명이인', nickname: '',
      },
    };
    const duplicate = createHarness({ documents: duplicateDocuments });
    const duplicateResponse = await request(duplicate.app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-3')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error).toBe('cashflow_executive_approver_people_uid_ambiguous');

    const stale = createHarness({ documents: completeDocuments });
    const staleResponse = await request(stale.app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'grant-4')
      .send({ approverUid: 'next-head-uid', expectedVersion: 6, reason: '조직 개편' });
    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body.error).toBe('version_conflict');
  });

  it('Firestore project document ID와 stored id가 다르면 다른 프로젝트 데이터를 빌리거나 수정하지 않는다', async () => {
    const documents = {
      ...completeDocuments,
      'orgs/tenant-a/projects/project-a': {
        ...completeDocuments['orgs/tenant-a/projects/project-a'],
        id: 'project-b',
        name: 'A 표시명',
      },
      'orgs/tenant-a/projects/project-b': {
        ...completeDocuments['orgs/tenant-a/projects/project-a'],
        id: 'project-b',
        name: 'B 표시명',
      },
      'orgs/tenant-a/cashflow_cumulative_close_heads/project-b': {
        ...completeDocuments['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'],
        projectId: 'project-b',
      },
    };
    const { app, store, audit } = createHarness({ documents });

    const read = await request(app).get('/api/v1/admin/cashflow-period-policy').expect(200);
    const mismatched = read.body.items.find((item) => item.project.name === 'A 표시명');
    expect(mismatched.project.id).toBe('project-a');
    expect(mismatched.authority.status).not.toBe('CLOSED');
    expect(mismatched.recovery.actionAllowed).toBe(false);
    expect(mismatched.recovery.resetToReclose.actionAllowed).toBe(false);
    expect(mismatched.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PROJECT_IDENTITY_MISMATCH', severity: 'ERROR' }),
    ]));

    const approver = await request(app)
      .patch('/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver')
      .set('x-idempotency-key', 'project-id-mismatch-approver')
      .send({ approverUid: 'next-head-uid', expectedVersion: 7, reason: '조직 개편' });
    expect(approver.status).toBe(409);
    expect(approver.body.error).toBe('cashflow_project_identity_mismatch');

    const recovery = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'project-id-mismatch-recovery')
      .send({ reason: '손상 권한 복구', expectedEvidence: {} });
    expect(recovery.status).toBe(409);
    expect(recovery.body.error).toBe('cashflow_project_identity_mismatch');

    const reset = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'project-id-mismatch-reset')
      .send({ reason: '재결산 준비', expectedEvidence: {} });
    expect(reset.status).toBe(409);
    expect(reset.body.error).toBe('cashflow_project_identity_mismatch');
    expect(store.get('orgs/tenant-a/projects/project-a').executiveApproverId).toBe('head-uid');
    expect(store.get('orgs/tenant-a/projects/project-b').executiveApproverId).toBe('head-uid');
    expect(audit).toEqual([]);
  });

  it.each([
    ['missing', 'READY', true],
    ['invalid', 'REPAIR_READY', true],
    ['valid', 'NORMAL_REOPEN_REQUIRED', false],
  ])('immutable evidence와 현재 head를 서버에서 조합해 %s 복구 상태를 반환한다', async (head, status, actionAllowed) => {
    const fixture = strictRecoveryDocuments({ head });
    const { app } = createHarness({ documents: fixture.documents });

    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const recovery = response.body.items.find((item) => item.project.id === 'project-a').recovery;

    expect(response.status).toBe(200);
    expect(recovery).toMatchObject({
      status,
      actionAllowed,
      expectedEvidence: actionAllowed ? {
        contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1',
        authorityFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        monthlyCloseId: 'project-a-2026-08',
        monthlyCloseVersionId: 'project-a-2026-08-r1',
        requestId: 'project-a-2026-08',
      } : null,
    });
    if (head === 'valid') {
      expect(recovery.guide).toContain('정상 재오픈');
    }
  });

  it('immutable evidence가 불완전하면 추측 복구를 금지하고 ERP 내부 격리·재결산 경로를 제공한다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    fixture.documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'].rootHash = 'broken';
    const { app } = createHarness({ documents: fixture.documents });
    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const recovery = response.body.items.find((item) => item.project.id === 'project-a').recovery;

    expect(response.status).toBe(200);
    expect(recovery).toMatchObject({
      status: 'UNREPAIRABLE',
      actionAllowed: false,
      expectedEvidence: null,
      nextAction: null,
      resetToReclose: {
        status: 'RESET_TO_RECLOSE_READY',
        actionAllowed: true,
        expectedEvidence: {
          contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1',
          monthlyCloseId: 'project-a-2026-08',
          yearMonth: '2026-08',
        },
      },
    });
    expect(recovery.guide).toContain('격리');
    expect(recovery.guide).toContain('정상 월결산');
  });

  it('authority/header/immutable evidence가 모두 없는 프로젝트는 추가 reset 없이 정상 재결산 가능 상태로 표시한다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    for (const path of Object.keys(fixture.documents)) {
      if (
        path.includes('/cashflow_cumulative_close_heads/project-a')
        || path.includes('/monthly_closes/project-a-')
        || path.includes('/monthly_close_versions/project-a-')
        || path.includes('/cashflow_month_close_requests/project-a-')
      ) delete fixture.documents[path];
    }
    const { app } = createHarness({ documents: fixture.documents });

    const response = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const reset = response.body.items.find((item) => item.project.id === 'project-a')
      .recovery.resetToReclose;

    expect(response.status).toBe(200);
    expect(reset).toMatchObject({
      status: 'RECLOSE_READY',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
      cycleCandidates: [],
    });
  });

  it('exact ACTIVE runtime admin이 손상 authority와 mutable current header를 감사 격리해 정상 재결산을 다시 열 수 있다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    const headPath = 'orgs/tenant-a/cashflow_cumulative_close_heads/project-a';
    const closePath = 'orgs/tenant-a/monthly_closes/project-a-2026-08';
    fixture.documents[headPath] = {
      ...fixture.documents[headPath],
      rootHash: 'broken',
      rawLegacyValue: 'head-before',
    };
    fixture.documents[closePath] = {
      tenantId: 'tenant-a', projectId: 'project-a', yearMonth: '2026-08',
      status: 'BROKEN', rawLegacyValue: 'header-before',
    };
    const immutableVersion = structuredClone(fixture.documents['orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1']);
    const immutableRequest = structuredClone(fixture.documents['orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08']);
    const { app, store, audit } = createHarness({ documents: fixture.documents });
    const read = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items.find((item) => item.project.id === 'project-a')
      .recovery.resetToReclose.expectedEvidence;

    const first = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-reclose-1')
      .send({ reason: '손상 authority와 현재 header 격리', expectedEvidence });
    const replay = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-reclose-1')
      .send({ reason: '손상 authority와 현재 header 격리', expectedEvidence });
    const lostResponseRetry = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-reclose-2')
      .send({ reason: '손상 authority와 현재 header 격리', expectedEvidence });
    const afterRead = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const afterReset = afterRead.body.items.find((item) => item.project.id === 'project-a')
      .recovery.resetToReclose;

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: 'RESET_TO_RECLOSE_COMPLETED', projectId: 'project-a', yearMonth: '2026-08',
      nextAction: { type: 'REVIEW_SHEET_AND_RECLOSE', href: '/portal/cashflow/project-a/sheets-lab' },
    });
    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(lostResponseRetry.status).toBe(200);
    expect(lostResponseRetry.body).toMatchObject({
      status: 'RESET_TO_RECLOSE_REPLAYED',
      projectId: 'project-a',
      yearMonth: '2026-08',
    });
    expect(afterReset).toMatchObject({
      status: 'RECLOSE_READY',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
    });
    expect(store.has(headPath)).toBe(false);
    expect(store.has(closePath)).toBe(false);
    expect(store.get('orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1')).toEqual(immutableVersion);
    expect(store.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08')).toEqual(immutableRequest);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_RESET_TO_RECLOSE',
      actorId: 'admin-uid',
      metadata: {
        before: {
          authority: { exists: true, value: expect.objectContaining({ rawLegacyValue: 'head-before' }) },
          monthlyClose: {
            exists: true,
            id: 'project-a-2026-08',
            value: expect.objectContaining({ status: 'BROKEN', rawLegacyValue: 'header-before' }),
          },
        },
        after: { authority: { exists: false }, monthlyClose: { exists: false } },
      },
    });
  });

  it('current header가 이미 없어도 immutable settlementMonth로 손상 authority만 격리하고 정상 close loop를 다시 연다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    const headPath = 'orgs/tenant-a/cashflow_cumulative_close_heads/project-a';
    const closePath = 'orgs/tenant-a/monthly_closes/project-a-2026-08';
    fixture.documents[headPath] = {
      ...fixture.documents[headPath],
      settlementMonth: 'broken',
      rootHash: 'broken',
    };
    delete fixture.documents[closePath];
    const { app, store, audit } = createHarness({ documents: fixture.documents });
    const read = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const reset = read.body.items.find((item) => item.project.id === 'project-a')
      .recovery.resetToReclose;

    expect(reset).toMatchObject({
      status: 'RESET_TO_RECLOSE_READY',
      actionAllowed: true,
      expectedEvidence: { yearMonth: '2026-08', monthlyCloseId: 'project-a-2026-08' },
    });
    const response = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-header-absent-1')
      .send({ reason: '남은 손상 authority 격리', expectedEvidence: reset.expectedEvidence });

    expect(response.status).toBe(200);
    expect(store.has(headPath)).toBe(false);
    expect(store.has(closePath)).toBe(false);
    expect(audit[0]).toMatchObject({
      metadata: { before: { monthlyClose: { exists: false, id: 'project-a-2026-08' } } },
    });

    const readDb = {
      doc(path) {
        return {
          async get() {
            return { exists: store.has(path), data: () => store.get(path) };
          },
        };
      },
    };
    await expect(assertCashflowMonthWritable({
      db: readDb,
      tenantId: 'tenant-a',
      projectId: 'project-a',
      yearMonth: '2026-08',
    })).resolves.toBeUndefined();
  });

  it('여러 immutable 회차는 서버 후보를 제공하고 선택한 opaque evidence를 transaction에서 다시 검증한다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    const headPath = 'orgs/tenant-a/cashflow_cumulative_close_heads/project-a';
    const closePath = 'orgs/tenant-a/monthly_closes/project-a-2026-08';
    const oldVersionPath = 'orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1';
    const priorVersionPath = 'orgs/tenant-a/monthly_close_versions/project-a-2026-07-r1';
    fixture.documents[headPath] = {
      ...fixture.documents[headPath], settlementMonth: 'broken', rootHash: 'broken',
    };
    delete fixture.documents[closePath];
    fixture.documents[priorVersionPath] = {
      ...fixture.documents[oldVersionPath], yearMonth: '2026-07', sourceRevision: null,
    };
    delete fixture.documents[oldVersionPath];
    const { app, store, audit } = createHarness({ documents: fixture.documents });

    const read = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const reset = read.body.items.find((item) => item.project.id === 'project-a')
      .recovery.resetToReclose;
    expect(reset).toMatchObject({
      status: 'RESET_CYCLE_SELECTION_REQUIRED',
      actionAllowed: false,
      selectionAllowed: true,
      expectedEvidence: null,
      cycleCandidates: [
        { yearMonth: '2026-08', yearMonthLabel: '2026년 8월' },
        { yearMonth: '2026-07', yearMonthLabel: '2026년 7월' },
      ],
    });
    const selected = reset.cycleCandidates.find((candidate) => candidate.yearMonth === '2026-08');
    const response = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-selected-cycle-1')
      .send({ reason: '서버 후보 중 2026년 8월 회차 선택', expectedEvidence: selected.expectedEvidence });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'RESET_TO_RECLOSE_COMPLETED', yearMonth: '2026-08' });
    expect(store.has(headPath)).toBe(false);
    expect(audit).toHaveLength(1);
  });

  it('reset-to-reclose는 권한·evidence drift·valid authority를 fail-closed하며 쓰기 0건을 유지한다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    const headPath = 'orgs/tenant-a/cashflow_cumulative_close_heads/project-a';
    const closePath = 'orgs/tenant-a/monthly_closes/project-a-2026-08';
    fixture.documents[headPath] = { ...fixture.documents[headPath], rootHash: 'broken' };
    const readHarness = createHarness({ documents: fixture.documents });
    const read = await request(readHarness.app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items[0].recovery.resetToReclose.expectedEvidence;

    const denied = createHarness({ documents: fixture.documents, actorId: 'head-uid', role: 'admin' });
    const deniedResponse = await request(denied.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-denied-1')
      .send({ reason: '권한 없는 격리', expectedEvidence });
    expect(deniedResponse.status).toBe(403);
    expect(denied.store.has(headPath)).toBe(true);
    expect(denied.store.has(closePath)).toBe(true);
    expect(denied.audit).toHaveLength(0);

    let mutated = false;
    const drift = createHarness({
      documents: fixture.documents,
      beforeTransaction(store) {
        if (mutated) return;
        mutated = true;
        store.set(closePath, { ...store.get(closePath), changedAfterReview: true });
      },
    });
    const driftResponse = await request(drift.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-drift-1')
      .send({ reason: '근거 변경 격리', expectedEvidence });
    expect(driftResponse.status).toBe(409);
    expect(driftResponse.body.error).toBe('cashflow_close_reset_to_reclose_evidence_changed');
    expect(drift.store.has(headPath)).toBe(true);
    expect(drift.store.has(closePath)).toBe(true);
    expect(drift.audit).toHaveLength(0);

    const validFixture = strictRecoveryDocuments({ head: 'valid', complete: false });
    const valid = createHarness({ documents: validFixture.documents });
    const validResponse = await request(valid.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose')
      .set('x-idempotency-key', 'reset-valid-1')
      .send({ reason: '유효 권한 격리 시도', expectedEvidence });
    expect(validResponse.status).toBe(409);
    expect(validResponse.body.error).toBe('cashflow_close_reset_to_reclose_normal_reopen_required');
    expect(valid.audit).toHaveLength(0);
  });

  it('exact ACTIVE runtime admin이 누락 head를 ERP에서 복구하고 idempotent replay에는 audit을 중복하지 않는다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'missing' });
    const { app, store, audit } = createHarness({ documents: fixture.documents });
    const read = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items.find((item) => item.project.id === 'project-a').recovery.expectedEvidence;

    const first = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-missing-1')
      .send({ reason: '누락된 누적 마감 권한 복구', expectedEvidence });
    const replay = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-missing-1')
      .send({ reason: '누락된 누적 마감 권한 복구', expectedEvidence });
    const lostResponseRetry = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-missing-new-key')
      .send({ reason: '누락된 누적 마감 권한 복구', expectedEvidence });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      projectId: 'project-a', status: 'RECOVERED', recoveryAction: 'BACKFILLED', changed: true,
    });
    expect(first.body.guide).toContain('정상 재오픈');
    expect(replay.status).toBe(200);
    expect(replay.headers['x-idempotency-replayed']).toBe('1');
    expect(lostResponseRetry.status).toBe(200);
    expect(lostResponseRetry.body).toMatchObject({ status: 'REPLAYED', changed: false, replayed: true });
    expect(store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toEqual(fixture.canonicalHead);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_BACKFILLED',
      actorId: 'admin-uid',
      metadata: { before: { exists: false }, after: fixture.canonicalHead },
    });
  });

  it('완전한 immutable evidence로 손상 head를 exact overwrite하고 full before/after audit을 남긴다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'invalid' });
    const before = fixture.documents['orgs/tenant-a/cashflow_cumulative_close_heads/project-a'];
    const { app, store, audit } = createHarness({ documents: fixture.documents });
    const read = await request(app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items.find((item) => item.project.id === 'project-a').recovery.expectedEvidence;

    const response = await request(app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-invalid-1')
      .send({ reason: '손상 authority exact 복구', expectedEvidence });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'RECOVERED', recoveryAction: 'REPAIRED', changed: true });
    expect(store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toEqual(fixture.canonicalHead);
    expect(store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).not.toHaveProperty('legacyField');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'CASHFLOW_CUMULATIVE_CLOSE_HEAD_REPAIRED',
      metadata: { before: { exists: true, value: before }, after: fixture.canonicalHead },
    });
  });

  it.each([
    ['viewer', 'head-uid', 'head@example.com'],
    ['inactive', 'inactive-admin-uid', 'inactive@example.com'],
    ['legacy', 'legacy-admin-uid', 'legacy@example.com'],
    ['email-only', 'bootstrap-email-only', 'mwbyun1220@mysc.co.kr'],
  ])('%s actor는 claim/email과 무관하게 exact ACTIVE canonical runtime admin이 아니므로 복구할 수 없다', async (_label, actorId, actorEmail) => {
    const fixture = strictRecoveryDocuments({ head: 'missing' });
    fixture.documents['orgs/tenant-a/persons/person-legacy-admin'] = {
      personId: 'person-legacy-admin', uid: 'legacy-admin-uid', name: '레거시 관리자',
    };
    fixture.documents['orgs/tenant-a/members/legacy-admin-document'] = {
      uid: 'legacy-admin-uid', role: 'admin', status: 'ACTIVE',
    };
    const admin = createHarness({ documents: fixture.documents });
    const read = await request(admin.app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items.find((item) => item.project.id === 'project-a').recovery.expectedEvidence;
    const denied = createHarness({ documents: fixture.documents, actorId, actorEmail, role: 'admin' });

    const response = await request(denied.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', `recover-denied-${actorId}`)
      .send({ reason: '권한 없는 복구 시도', expectedEvidence });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('runtime_superadmin_required');
    expect(denied.store.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(denied.audit).toHaveLength(0);
  });

  it('planning 뒤 immutable evidence가 변하면 head/audit을 0건 유지하고 한국어 재조회 가이드를 반환한다', async () => {
    const fixture = strictRecoveryDocuments({ head: 'missing', includeProjectB: true });
    let mutated = false;
    const harness = createHarness({
      documents: fixture.documents,
      beforeTransaction(store) {
        if (mutated) return;
        mutated = true;
        const path = 'orgs/tenant-a/monthly_close_versions/project-a-2026-08-r1';
        store.set(path, { ...store.get(path), sourceRevision: `sha256:${'9'.repeat(64)}` });
      },
    });
    const read = await request(harness.app).get('/api/v1/admin/cashflow-period-policy');
    const expectedEvidence = read.body.items.find((item) => item.project.id === 'project-a').recovery.expectedEvidence;

    const response = await request(harness.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-drift-1')
      .send({ reason: '누락 권한 복구', expectedEvidence });
    const after = await request(harness.app).get('/api/v1/admin/cashflow-period-policy');

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('cashflow_close_head_recovery_evidence_changed');
    expect(response.body.message).toContain('다시 불러온 뒤');
    expect(harness.store.has('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toBe(false);
    expect(harness.audit).toHaveLength(0);
    expect(after.status).toBe(200);
    expect(after.body.items.map((item) => item.project.id)).toContain('project-b');
  });

  it('불완전 evidence와 이미 유효한 CLOSED head는 각각 fail-closed/no-op하며 head를 덮지 않는다', async () => {
    const incompleteFixture = strictRecoveryDocuments({ head: 'invalid', complete: false });
    const incomplete = createHarness({ documents: incompleteFixture.documents });
    const incompleteBefore = { ...incomplete.store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a') };
    const incompleteResponse = await request(incomplete.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-incomplete-1')
      .send({ reason: '불완전 증거 복구 시도', expectedEvidence: { contractVersion: 'invalid' } });
    expect(incompleteResponse.status).toBe(409);
    expect(incompleteResponse.body.error).toBe('cashflow_close_head_recovery_unrepairable');
    expect(incompleteResponse.body.message).toContain('시트 검증본');
    expect(incomplete.store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toEqual(incompleteBefore);
    expect(incomplete.audit).toHaveLength(0);

    const validFixture = strictRecoveryDocuments({ head: 'valid' });
    const valid = createHarness({ documents: validFixture.documents });
    const validResponse = await request(valid.app)
      .post('/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery')
      .set('x-idempotency-key', 'recover-valid-1')
      .send({ reason: '유효 head 복구 시도', expectedEvidence: { contractVersion: 'invalid' } });
    expect(validResponse.status).toBe(409);
    expect(validResponse.body.error).toBe('cashflow_close_head_recovery_normal_reopen_required');
    expect(validResponse.body.message).toContain('정상 재오픈');
    expect(valid.store.get('orgs/tenant-a/cashflow_cumulative_close_heads/project-a')).toEqual(validFixture.canonicalHead);
    expect(valid.audit).toHaveLength(0);
  });
});
