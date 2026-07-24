import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildCashflowManagementChecks, mountJvmWeeklyApiRoutes } from './jvm-weekly-api.mjs';

function createIdempotencyService() {
  return {
    begin: vi.fn(async () => ({ mode: 'new', requestFingerprint: 'fp' })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

const stageEnv = {
  BFF_DEPLOY_ENV: 'stage',
  BFF_EDIT_LEASES_ENABLED: 'true',
  VITE_FIREBASE_PROJECT_ID: 'stage-data-project',
  JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'stage-data-project',
};

const editLeaseHeaders = {
  'x-edit-session-id': 'session-a',
  'x-edit-lease-id': 'lease-a',
  'x-edit-fence': '7',
};

const cashflowLineIds = [
  'MYSC_PREPAY_IN', 'MYSC_PREPAY_LABOR_IN', 'MYSC_PREPAY_INPUT_VAT_IN',
  'SALES_IN', 'SALES_VAT_IN', 'TEAM_SUPPORT_IN', 'BANK_INTEREST_IN',
  'MYSC_PREPAY_DIRECT_OUT', 'MYSC_PREPAY_LABOR_OUT', 'DIRECT_COST_OUT',
  'INPUT_VAT_OUT', 'MYSC_LABOR_OUT', 'MYSC_PROFIT_OUT', 'SALES_VAT_OUT',
  'TEAM_SUPPORT_OUT', 'BANK_INTEREST_OUT',
];

const managementConfirmations = [
  'labor-transfer',
  'profit-vat-after-deposit',
  'negative-projection-balance',
  'future-prepay-over-million',
].map((checkId) => ({ checkId, decision: 'CONFIRMED' }));

const emptyManagementChecks = [
  { id: 'labor-transfer', status: 'WARNING', title: 'MYSC 인건비 이관', detail: '2026-06 3주차 · Projection 인건비 미기입' },
  { id: 'profit-vat-after-deposit', status: 'REVIEW_REQUIRED', title: '입금 후 MYSC 수익·매출부가세 이관', detail: '실제 입금 확인 건이 없습니다. 해당 없음 여부를 사람이 확인해 주세요.' },
  { id: 'negative-projection-balance', status: 'OK', title: 'Projection 잔액 마이너스', detail: 'Projection 누적 잔액이 0원 이상입니다.' },
  { id: 'future-prepay-over-million', status: 'OK', title: '금주 이후 선입금 요청 100만원 초과', detail: '금주 이후 100만원 초과 요청이 없습니다.' },
];

function monthDashboardSource(
  monthClose,
  cashflow = { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } },
  openingBalances = {
    selectedYear: Number(String(monthClose.yearMonth || '2026-01').slice(0, 4)),
    projection: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
    actual: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
  },
  snapshotCompatibility = {
    status: monthClose.status === 'OPEN' ? 'LIVE_CURRENT' : 'FROZEN_COMPLETE',
    missingEvidence: [],
  },
) {
  return {
    monthClose,
    cashflow: monthClose.status === 'OPEN' ? cashflow : null,
    openingBalances,
    snapshotCompatibility,
  };
}

function projectionOpeningBalance(lineId, amount = 2_000_000) {
  return {
    selectedYear: 2026,
    projection: annualOpeningMode(lineId, amount),
    actual: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
  };
}

function annualOpeningMode(lineId, amount, year = 2025) {
  const lineStates = Object.fromEntries(cashflowLineIds.map((candidate) => [
    candidate,
    candidate === lineId ? 'VALUE' : 'EMPTY',
  ]));
  return {
    amount,
    lineAmounts: { [lineId]: amount },
    sources: [{ year, lineAmounts: { [lineId]: amount }, lineStates }],
    includedYears: [year],
    excludedWeeklyYears: [],
  };
}

function matchingControlRows(startRow, matches = true) {
  return Array.from({ length: 19 }, (_, index) => ({
    sourceCell: `BO${startRow + index}`, value: 0, computed: 0, matches,
  }));
}

function fullMonthCloseSource({ mirrorStatus = 'FRESH', controlMatches = true, calculationMismatch = false, contractAmount = 1000 } = {}) {
  const sourceRevision = `sha256:${'c'.repeat(64)}`;
  const targetRevision = `sha256:${'d'.repeat(64)}`;
  const cells = [];
  const confirmations = [];
  for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
    for (const mode of ['projection', 'actual']) {
      for (const lineId of cashflowLineIds) {
        cells.push({
          mode, yearMonth: '2026-06', weekNo, lineId, direction: cashflowLineIds.indexOf(lineId) < 7 ? 'IN' : 'OUT',
          state: 'VALUE', amount: mode === 'projection' ? 10 : 5,
        });
        confirmations.push({ mode, weekNo, cashflowLine: lineId, decision: 'CONFIRMED' });
      }
    }
  }
  const depositScheduleRows = Array.from({ length: 5 }, (_, index) => ({
    weekNo: index + 1,
    taxInvoiceIssuedDate: `2026-06-${String(index + 1).padStart(2, '0')}`,
    expectedDepositDate: `2026-06-${String(index + 6).padStart(2, '0')}`,
    expectedDepositAmount: (index + 1) * 1000,
    actualDepositDate: '', actualDepositAmount: null,
    actualSource: 'NOT_APPLICABLE', decision: 'CONFIRMED',
  }));
  const closeInput = {
    yearMonth: '2026-06', sourceRevision, targetRevision,
    depositScheduleRows,
    cells: cells.map(({ lineId, state, yearMonth: _yearMonth, direction: _direction, ...cell }) => ({
      ...cell, cashflowLine: lineId, cellState: state,
    })),
    confirmations,
    managementConfirmations,
  };
  const sheetFacts = {
    metadata: {
      lastUpdateText: { sourceCell: 'B1', value: '최종 업데이트 : 2026.07.01 최종작성자: 보람' },
      businessType: { sourceCell: 'B2', value: 'Type1. 세금계산서발행+공급가액기준' },
      accountType: { sourceCell: 'B3', value: '전용계좌사업' },
      settlementStatus: { sourceCell: 'B4', value: '정산진행' },
    },
    depositScheduleRows: depositScheduleRows.map((row) => ({
      yearMonth: '2026-06', weekNo: row.weekNo,
      taxInvoiceIssuedDate: row.taxInvoiceIssuedDate,
      expectedDepositDate: row.expectedDepositDate,
      expectedDepositAmount: row.expectedDepositAmount,
      sourceCells: {},
    })),
    controlTotals: {
      deposit: { sourceCell: 'BO9', value: 15000, computed: 15000, matches: controlMatches },
      unpaid: { sourceCell: 'BP9', value: 85000 },
      projection: matchingControlRows(14, controlMatches),
      actual: matchingControlRows(37, controlMatches),
    },
    ...(calculationMismatch ? {
      weeklyCalculationChecks: Array.from({ length: 10 }, (_, index) => ({
        mode: index < 5 ? 'projection' : 'actual',
        yearMonth: '2026-06',
        weekNo: (index % 5) + 1,
        sourceCells: {},
        matches: index === 0
          ? { depositTotal: false, withdrawalTotal: true, balance: true }
          : { depositTotal: true, withdrawalTotal: true, balance: true },
      })),
    } : {}),
    issues: [],
  };
  const draftId = `v1_${Buffer.from(JSON.stringify(['cashflow', 'project-a', 'pm-1']), 'utf8').toString('base64url')}`;
  const documents = new Map([
    ['orgs/tenant-a/projects/project-a', {
      id: 'project-a', settlementType: 'TYPE1', basis: '공급가액', accountType: 'DEDICATED',
      fundInputMode: 'BANK_UPLOAD', contractAmount,
    }],
    [`orgs/tenant-a/privateEditDrafts/${draftId}`, {
      tenantId: 'tenant-a', ownerUid: 'pm-1', resourceType: 'cashflow', resourceId: 'project-a',
      status: 'ACTIVE', draftRevision: 7,
      payload: { monthClose: closeInput },
    }],
    ['orgs/tenant-a/cashflow_sheet_mirrors/project-a', {
      projectId: 'project-a', status: mirrorStatus, sourceRevision, appliedSourceRevision: sourceRevision, targetRevisionAtFetch: targetRevision,
      yearMonths: ['2026-06'], capturedAt: '2026-07-01T00:00:00.000Z', configRevision: `sha256:${'e'.repeat(64)}`,
      cells, sheetFacts,
    }],
  ]);
  return {
    db: {
      doc: (path) => ({
        get: async () => {
          const value = documents.get(path);
          return { exists: value !== undefined, data: () => value };
        },
        set: async (value) => documents.set(path, value),
      }),
      collection: (path) => ({
        where: (_field, _operator, projectId) => ({
          limit: () => ({
            get: async () => ({
              docs: [...documents.entries()]
                .filter(([documentPath, value]) => documentPath.startsWith(`${path}/`) && value.projectId === projectId)
                .map(([_documentPath, value]) => ({ data: () => value })),
            }),
          }),
        }),
      }),
    },
    documents,
    sourceRevision,
    targetRevision,
    closeInput,
  };
}

function createMonthCloseDb() {
  const sourceRevision = `sha256:${'c'.repeat(64)}`;
  const targetRevision = `sha256:${'d'.repeat(64)}`;
  const depositScheduleRows = Array.from({ length: 5 }, (_, index) => ({
    weekNo: index + 1,
    taxInvoiceIssuedDate: '', expectedDepositDate: '', actualDepositDate: '',
    actualSource: 'NOT_APPLICABLE', decision: 'NOT_APPLICABLE',
  }));
  const draftId = `v1_${Buffer.from(JSON.stringify(['cashflow', 'project-a', 'pm-1']), 'utf8').toString('base64url')}`;
  const documents = new Map([
    [`orgs/tenant-a/privateEditDrafts/${draftId}`, {
      tenantId: 'tenant-a', ownerUid: 'pm-1', resourceType: 'cashflow', resourceId: 'project-a',
      status: 'ACTIVE', draftRevision: 7,
      payload: { monthClose: {
        yearMonth: '2026-06', sourceRevision, targetRevision,
        depositScheduleRows,
        cells: [{ mode: 'projection', weekNo: 1, cashflowLine: 'SALES_IN', cellState: 'VALUE', amount: 1234 }],
        confirmations: [{ mode: 'projection', weekNo: 1, cashflowLine: 'SALES_IN', decision: 'CONFIRMED' }],
        managementChecks: emptyManagementChecks,
        managementConfirmations,
        deadlineSummary: { trackingStartedAt: null, missedCount: 0, completedCount: 0, current: null },
      } },
    }],
    ['orgs/tenant-a/cashflow_sheet_mirrors/project-a', {
      projectId: 'project-a', status: 'FRESH', sourceRevision, appliedSourceRevision: sourceRevision, targetRevisionAtFetch: targetRevision,
      yearMonths: ['2026-06'], capturedAt: '2026-07-01T00:00:00.000Z',
      sheetFacts: {
        metadata: {},
        depositScheduleRows: depositScheduleRows.map((row) => ({
          yearMonth: '2026-06', weekNo: row.weekNo,
          taxInvoiceIssuedDate: '', expectedDepositDate: '', expectedDepositAmount: null,
          sourceCells: {},
        })),
        controlTotals: {
          deposit: { sourceCell: 'BO9', value: 0, computed: 0, matches: true },
          unpaid: { sourceCell: 'BP9', value: null },
          projection: matchingControlRows(14),
          actual: matchingControlRows(37),
        },
        issues: [],
      },
    }],
  ]);
  return {
    documents,
    doc: (path) => ({
      get: async () => {
        const value = documents.get(path);
        return { exists: value !== undefined, data: () => value };
      },
      set: async (value) => documents.set(path, value),
    }),
  };
}

const weeklyLeaseWriterRoutes = [
  '/api/v1/weekly-expenses/project-a/sheets/default/save-draft',
  '/api/v1/weekly-expenses/project-a/bank-statements/import-batch',
  '/api/v1/weekly-expenses/project-a/bank-statements/apply-items',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/copy',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/paste',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/cut',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/row-insert',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/row-delete',
];

const unlockedCashflowWriterRoutes = [
  '/api/v1/cashflow-metadata/project-a/variance',
];

function createApp(fetchImpl, idempotencyService = createIdempotencyService(), contextPatch = {}, routeOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-1',
      idempotencyKey: req.header('idempotency-key') || undefined,
      ...contextPatch,
    };
    next();
  });
  mountJvmWeeklyApiRoutes(app, {
    idempotencyService,
    fetchImpl,
    jvmWeeklyApiBaseUrl: 'http://jvm-weekly.local',
    jvmWeeklyApiServiceToken: 'test-service-token',
    ...routeOptions,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      code: error.code || 'error',
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });
  return { app, idempotencyService };
}

describe('JVM weekly API BFF proxy', () => {
  it('rejects only weekly-expense writers before the JVM when their edit lease is missing', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
    }, { env: stageEnv });

    for (const [index, path] of weeklyLeaseWriterRoutes.entries()) {
      await request(app)
        .post(path)
        .set('idempotency-key', `missing-lease-${index}`)
        .send({})
        .expect(400)
        .expect((response) => {
          expect(response.body.code).toBe('cashflow_edit_lease_request_invalid');
        });
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  }, 15_000);

  it.each(weeklyLeaseWriterRoutes)(
    'forwards the same validated weekly-expense lease to writer %s',
    async (path) => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
    }, { env: stageEnv });

      await request(app)
        .post(path)
        .set({
          'idempotency-key': `valid-lease-${weeklyLeaseWriterRoutes.indexOf(path)}`,
          ...editLeaseHeaders,
        })
        .send({})
        .expect(200);

      expect(calls).toHaveLength(1);
      expect(calls[0].init.headers).toMatchObject({
        'x-data-project-id': 'stage-data-project',
        ...editLeaseHeaders,
      });
      expect(calls[0].init.headers['x-edit-finalize']).toBeUndefined();
    },
  );

  it.each(unlockedCashflowWriterRoutes)('does not forward edit-lease headers to cashflow writer %s', async (path) => {
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      init,
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1', actorRole: 'admin',
    }, { env: stageEnv });

    await request(app)
      .post(path)
      .set({
        'idempotency-key': 'final-projection-1',
        ...editLeaseHeaders,
        'x-edit-finalize': 'true',
      })
      .send({ lines: [] })
      .expect(200);

    const headers = fetchImpl.mock.calls[0][1].headers;
    expect(headers['x-edit-session-id']).toBeUndefined();
    expect(headers['x-edit-lease-id']).toBeUndefined();
    expect(headers['x-edit-fence']).toBeUndefined();
    expect(headers['x-edit-finalize']).toBeUndefined();
  });

  it('routes variance metadata through the JVM instead of writing cashflow_weeks in the BFF', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a', sheetId: 'week-a', varianceRevision: 3, action: 'FLAG',
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/cashflow-metadata/project-a/variance')
      .set({ 'idempotency-key': 'variance-jvm-1', ...editLeaseHeaders })
      .send({
        sheetId: 'week-a', expectedRevision: 2, action: 'FLAG', content: '입금 편차 확인',
        tenantId: 'spoofed', actor: { id: 'spoofed' },
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a/variance');
    expect(calls[0].init.headers).toMatchObject({
      'x-data-project-id': 'stage-data-project',
      'x-actor-role': 'finance',
    });
    expect(calls[0].init.headers['x-edit-session-id']).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'variance-jvm-1',
      sheetId: 'week-a', expectedRevision: 2, action: 'FLAG', content: '입금 편차 확인',
    });
  });

  it('reads a cashflow month-close through the JVM with the requested yearMonth', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true,
        projectId: 'project-a',
        yearMonth: '2026-06',
        status: 'CLOSED',
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'auditor-1',
      actorRole: 'auditor',
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          projectId: 'project-a',
          yearMonth: '2026-06',
          status: 'CLOSED',
        });
      });

    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://jvm-weekly.local/api/v1/cashflow/project-a/month-close/dashboard-source?yearMonth=2026-06',
    );
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it('combines explicit sheet refresh and JVM month-close audit records for the activity timeline', async () => {
    const eventsByCollection = {
      cashflow_sheet_refresh_runs: [{
        id: 'refresh-1', projectId: 'project-a', idempotencyKey: 'refresh-key', status: 'COMPLETED',
        createdAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-07-01T00:01:00.000Z',
        createdBy: { uid: 'pm-1', name: '변민욱(보람)', email: 'pm@example.com' },
        response: { status: 'FRESH', selectedSheetName: 'cashflow(사용내역 연동)' },
      }],
      weekly_api_audit_events: [
        {
          id: 'close-1', projectId: 'project-a', idempotencyKey: 'close-key', commandName: 'cashflowMonth.close',
          actorId: 'pm-1', createdAt: '2026-07-02T00:00:00.000Z',
          metadataJson: JSON.stringify({ yearMonth: '2026-06', status: 'CLOSED', actorEmail: 'pm@example.com' }),
        },
        {
          id: 'apply-1', projectId: 'project-a', idempotencyKey: 'apply-key', commandName: 'weeklyExpense.cashflowSheetLab.apply',
          actorId: 'pm-1', createdAt: '2026-07-01T12:00:00.000Z',
          metadataJson: JSON.stringify({
            yearMonth: '2026-06', projectionLineCount: 8, actualLineCount: 7,
            actorName: '변민욱(보람)', actorEmail: 'pm@example.com',
          }),
        },
        {
          id: 'apply-annual-1', projectId: 'project-a', idempotencyKey: 'apply-annual-key', commandName: 'weeklyExpense.cashflowSheetLab.apply',
          actorId: 'pm-1', createdAt: '2026-07-01T13:00:00.000Z',
          metadataJson: JSON.stringify({
            scope: 'annual', year: 2025, projectionLineCount: 16, actualLineCount: 16,
            actorName: '변민욱(보람)', actorEmail: 'pm@example.com',
          }),
        },
      ],
      cashflow_events: [],
    };
    const db = {
      collection: (path) => ({
        where: () => ({
          limit: () => ({
            get: async () => ({ docs: (eventsByCollection[path.split('/').at(-1)] || []).map((data) => ({ id: data.id, data: () => data })) }),
          }),
        }),
      }),
    };
    const { app } = createApp(vi.fn(), createIdempotencyService(), {}, { env: stageEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/activity')
      .expect(200)
      .expect((response) => {
        expect(response.body.events).toMatchObject([
          { type: 'month_close', yearMonth: '2026-06', status: 'CLOSED' },
          { type: 'sheet_apply', scope: 'annual', year: 2025, appliedLineCount: 32 },
          {
            type: 'sheet_apply', yearMonth: '2026-06', appliedLineCount: 15,
            actorName: '변민욱(보람)', actorEmail: 'pm@example.com',
          },
          { type: 'sheet_refresh', sheetName: 'cashflow(사용내역 연동)', actorName: '변민욱(보람)', actorEmail: 'pm@example.com' },
        ]);
      });
  });

  it('composes the open-month dashboard from the pinned sheet, project, and JVM state without a private draft', async () => {
    const { db, sourceRevision, targetRevision } = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard).toMatchObject({
          source: { status: 'FRESH', sourceRevision, targetRevision },
          project: {
            settlementType: 'TYPE1', basis: '공급가액', accountType: 'DEDICATED', contractAmount: 1000,
          },
          sheetControlTotals: {
            deposit: { sourceCell: 'BO9', value: 15000, computed: 15000, matches: true },
            unpaid: { sourceCell: 'BP9', value: 85000 },
          },
          totals: {
            projection: { totalIn: 350, totalOut: 450, balance: -100 },
            actual: { totalIn: 175, totalOut: 225, balance: -50 },
            difference: { totalIn: 175, totalOut: 225, balance: -50 },
          },
          summary: {
            projectionProgressPercent: 35,
            actualProgressPercent: 100,
            confirmationProgressPercent: 0,
            settlementProgressPercent: 0,
            settlementCompletedWeekCount: 0,
            settlementTargetWeekCount: 5,
          },
          validation: { canClose: true, blockers: [] },
        });
        expect(response.body.dashboard.cells).toHaveLength(160);
        expect(response.body.dashboard.depositScheduleRows).toHaveLength(5);
      });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stores and resets a project-scoped Stage QA date-time for Finance', async () => {
    const db = createMonthCloseDb();
    const { app } = createApp(vi.fn(), createIdempotencyService(), { actorRole: 'finance' }, { env: stageEnv, db });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/qa-date')
      .send({ qaDateTime: '2026-07-16T23:59' })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        projectId: 'project-a', active: true, qaDateTime: '2026-07-16T23:59',
      }));

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close/qa-date')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({ active: true, qaDateTime: '2026-07-16T23:59' }));

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/qa-date')
      .send({ qaDateTime: null })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({ active: false, qaDateTime: null }));
  });

  it('uses the Stage QA time on both sides of the Thursday midnight deadline', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_stage_runs/tracking-start', {
      projectId: 'project-a', status: 'APPLIED', appliedAt: '2026-07-06T10:00:00+09:00',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource(
        {
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        },
        undefined,
        {
          selectedYear: 2026,
          projection: annualOpeningMode('SALES_IN', 2_000_000),
          actual: annualOpeningMode('SALES_IN', 1_800_000),
        },
      )),
    }));
    const qaPath = 'orgs/tenant-a/cashflow_month_close_qa_dates/project-a';
    source.documents.set(qaPath, { active: true, qaDateTime: '2026-07-16T23:59:00+09:00' });
    const before = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });
    await request(before.app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary.current).toMatchObject({ status: 'PENDING' });
        expect(response.body.dashboard.deadlineSummary.weeklyStatuses).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 4, status: 'PENDING' }),
        ]));
      });

    source.documents.set(qaPath, { active: true, qaDateTime: '2026-07-17T00:01:00+09:00' });
    const after = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });
    await request(after.app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary.current).toMatchObject({ status: 'MISSED' });
        expect(response.body.dashboard.deadlineSummary.missedCount).toBeGreaterThan(0);
      });
  });

  it('persists the explicit weekly settlement completion with its actor and exposes it in the dashboard', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_stage_runs/tracking-start', {
      projectId: 'project-a', status: 'APPLIED', appliedAt: '2026-07-06T10:00:00+09:00',
    });
    source.documents.set('orgs/tenant-a/cashflow_month_close_qa_dates/project-a', {
      active: true, qaDateTime: '2026-07-16T18:00:00+09:00',
    });
    const fetchImpl = vi.fn(async (url, init) => {
      if (init.method === 'POST' && url.endsWith('/api/v1/cashflow/project-a/weekly-update-complete')) {
        const body = JSON.parse(init.body);
        source.documents.set('orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3', {
          projectId: 'project-a', yearMonth: body.yearMonth, weekNo: body.weekNo,
          status: 'LOCKED', completedAt: body.completedAt, completedByEmail: 'pm@example.com',
        });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true, projectId: 'project-a', yearMonth: body.yearMonth, weekNo: body.weekNo,
            completedAt: body.completedAt, completedBy: 'pm@example.com', alreadyCompleted: false,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, { env: stageEnv, db: source.db });

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        projectId: 'project-a', yearMonth: '2026-07', weekNo: 3, alreadyCompleted: false,
      }));

    const saved = source.documents.get('orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3');
    expect(saved).toMatchObject({ projectId: 'project-a', yearMonth: '2026-07', weekNo: 3 });
    source.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-06', {
      projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://jvm-weekly.local/api/v1/cashflow/project-a/weekly-update-complete',
      expect.objectContaining({ method: 'POST' }),
    );

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary.current).toMatchObject({
          yearMonth: '2026-07', weekNo: 3, status: 'COMPLETED',
        });
        expect(response.body.dashboard.deadlineSummary.completedWeeks).toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 3, completedBy: 'pm@example.com' }),
        ]));
        expect(response.body.dashboard.deadlineSummary.weeklyStatuses).toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 3, status: 'COMPLETED' }),
        ]));
        expect(response.body.dashboard.monthCloseStatuses).toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-06', status: 'CLOSED' }),
        ]));
      });
  });

  it('forwards an explicit weekly scope and a reasoned reopen without an edit lease', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : {};
      if (init.method === 'GET' && url.includes('/weekly-update-complete?')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true, projectId: 'project-a', yearMonth: '2026-06', weekNo: 2,
            status: 'LOCKED', revision: 1,
          }),
        };
      }
      if (url.endsWith('/api/v1/cashflow/project-a/weekly-update-complete/reopen')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true, projectId: 'project-a', yearMonth: body.yearMonth, weekNo: body.weekNo,
            status: 'OPEN', revision: 2, reopenReason: body.reason,
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true, projectId: 'project-a', yearMonth: body.yearMonth, weekNo: body.weekNo,
          status: 'LOCKED', revision: 1,
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, { env: stageEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/weekly-update-complete?yearMonth=2026-06&weekNo=2')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        yearMonth: '2026-06', weekNo: 2, status: 'LOCKED', revision: 1,
      }));

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06', weekNo: 2 })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        yearMonth: '2026-06', weekNo: 2, status: 'LOCKED', revision: 1,
      }));

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete/reopen')
      .send({ yearMonth: '2026-06', weekNo: 2, expectedRevision: 1, reason: '긴급 정정' })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        yearMonth: '2026-06', weekNo: 2, status: 'OPEN', revision: 2, reopenReason: '긴급 정정',
      }));

    const completeCall = fetchImpl.mock.calls.find(([url]) => url.endsWith('/weekly-update-complete'));
    expect(JSON.parse(completeCall[1].body)).toMatchObject({ yearMonth: '2026-06', weekNo: 2 });
    const reopenCall = fetchImpl.mock.calls.find(([url]) => url.endsWith('/weekly-update-complete/reopen'));
    expect(reopenCall[1].headers).not.toHaveProperty('x-edit-session-id');
    expect(JSON.parse(reopenCall[1].body)).toMatchObject({
      yearMonth: '2026-06', weekNo: 2, expectedRevision: 1, reason: '긴급 정정',
    });
  });

  it('does not count a reopened weekly completion as settled', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_stage_runs/tracking-start', {
      projectId: 'project-a', status: 'APPLIED', appliedAt: '2026-07-06T10:00:00+09:00',
    });
    source.documents.set('orgs/tenant-a/cashflow_month_close_qa_dates/project-a', {
      active: true, qaDateTime: '2026-07-16T18:00:00+09:00',
    });
    source.documents.set('orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3', {
      projectId: 'project-a', yearMonth: '2026-07', weekNo: 3, status: 'OPEN',
      completedAt: '2026-07-16T09:00:00+09:00', reopenedAt: '2026-07-16T10:00:00+09:00',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.dashboard.deadlineSummary.current).toMatchObject({
        yearMonth: '2026-07', weekNo: 3, status: 'PENDING', completedAt: null,
      }));
  });

  it('rejects incomplete weekly scopes before the JVM and preserves a JVM lock conflict', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({
        code: 'weekly_expense_conflict',
        message: 'Cashflow week is locked: 2026-06 2주차.',
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, {
      env: stageEnv,
      db: fullMonthCloseSource().db,
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/weekly-update-complete?yearMonth=2026-06&weekNo=6')
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('cashflow_weekly_update_scope_invalid'));
    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06' })
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('cashflow_weekly_update_scope_invalid'));
    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '' })
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('cashflow_weekly_update_scope_invalid'));
    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete/reopen')
      .send({ yearMonth: '2026-06', weekNo: 2, expectedRevision: 1, reason: '' })
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('cashflow_weekly_reopen_request_invalid'));
    expect(fetchImpl).not.toHaveBeenCalled();

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06', weekNo: 2 })
      .expect(409)
      .expect((response) => expect(response.body).toMatchObject({
        code: 'weekly_expense_conflict',
        message: expect.stringContaining('locked'),
      }));
  });

  it('preserves a JVM weekly settlement outage code and 503 status', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({
        code: 'cashflow_weekly_completion_backend_unavailable',
        message: 'Cashflow weekly completion backend is unavailable.',
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, {
      env: stageEnv,
      db: fullMonthCloseSource().db,
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06', weekNo: 2 })
      .expect(503)
      .expect((response) => expect(response.body).toMatchObject({
        code: 'cashflow_weekly_completion_backend_unavailable',
        message: expect.stringContaining('처리하지 못했습니다'),
      }));
  });

  it('returns the four PPT 38 management checks from canonical server values', () => {
    const { documents } = fullMonthCloseSource();
    const draft = [...documents.values()].find((value) => value?.resourceType === 'cashflow');
    const project = documents.get('orgs/tenant-a/projects/project-a');
    const checks = buildCashflowManagementChecks({
      project,
      cashflow: { readModel: { months: [] } },
      cells: draft.payload.monthClose.cells,
      yearMonth: '2026-06',
      depositScheduleRows: draft.payload.monthClose.depositScheduleRows,
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-07', weekNo: 2 } },
    });

    expect(checks).toHaveLength(4);
    expect(checks.map((check) => [check.id, check.status])).toEqual([
      ['labor-transfer', 'WARNING'],
      ['profit-vat-after-deposit', 'REVIEW_REQUIRED'],
      ['negative-projection-balance', 'WARNING'],
      ['future-prepay-over-million', 'OK'],
    ]);
    expect(checks[0].detail).toContain('일부 이관');
  });

  it('flags missing labor, post-deposit transfer, negative balance, and future prepay on the server', () => {
    const { documents } = fullMonthCloseSource();
    const draft = [...documents.values()].find((value) => value?.resourceType === 'cashflow');
    const cells = draft.payload.monthClose.cells.map((cell) => (
      cell.mode === 'actual' && cell.weekNo === 3 && cell.cashflowLine === 'MYSC_LABOR_OUT' ? { ...cell, amount: 0 } : cell
    ));
    const depositScheduleRows = draft.payload.monthClose.depositScheduleRows.map((row) => (
      row.weekNo === 5
        ? { ...row, actualDepositDate: '2026-06-30', actualDepositAmount: 1_000_000, actualSource: 'SHEET' }
        : row
    ));
    const juneMonth = {
      yearMonth: '2026-06',
      projection: {
        weeks: Array.from({ length: 5 }, (_, index) => ({
          weekNo: index + 1,
          amounts: Object.fromEntries(cells
            .filter((cell) => cell.mode === 'projection' && cell.weekNo === index + 1)
            .map((cell) => [cell.cashflowLine, cell.amount])),
        })),
      },
      actual: {
        weeks: Array.from({ length: 5 }, (_, index) => ({
          weekNo: index + 1,
          amounts: Object.fromEntries(cells
            .filter((cell) => cell.mode === 'actual' && cell.weekNo === index + 1)
            .map((cell) => [cell.cashflowLine, cell.amount])),
        })),
      },
    };
    const checks = buildCashflowManagementChecks({
      project: {},
      cashflow: {
        readModel: {
          months: [juneMonth, {
            yearMonth: '2026-08',
            projection: { weeks: [{ weekNo: 1, amounts: { MYSC_PREPAY_IN: 1_000_001 } }] },
            actual: { weeks: [] },
          }],
        },
      },
      cells,
      yearMonth: '2026-06',
      depositScheduleRows,
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-07', weekNo: 2 } },
    });

    expect(checks.map((check) => [check.id, check.status])).toEqual([
      ['labor-transfer', 'WARNING'],
      ['profit-vat-after-deposit', 'WARNING'],
      ['negative-projection-balance', 'WARNING'],
      ['future-prepay-over-million', 'WARNING'],
    ]);
    expect(checks[1].detail).toContain('다음 주차 원장 없음');
    expect(checks[0].detail).toContain('실제 0원 · 실제 미이관');
    expect(checks[0].findings).toContain('2026-06 3주차 · 예정 10원 · 실제 0원 · 실제 미이관');
    expect(checks[2].findings).toHaveLength(1);
    expect(checks[2].findings[0]).toContain('2026-06 1주차');
    expect(checks[2].findings[0]).toContain('2026-06 5주차까지');
    expect(checks[3].detail).toContain('1,000,001원');
  });

  it('prioritizes an empty third-week Projection over an explicit zero amount', () => {
    const { documents } = fullMonthCloseSource();
    const draft = [...documents.values()].find((value) => value?.resourceType === 'cashflow');
    const cells = draft.payload.monthClose.cells.map((cell) => (
      cell.mode === 'projection' && cell.weekNo === 3 && cell.cashflowLine === 'MYSC_LABOR_OUT'
        ? { ...cell, cellState: 'EMPTY' }
        : cell
    ));
    const checks = buildCashflowManagementChecks({
      cashflow: { readModel: { months: [] } },
      cells,
      yearMonth: '2026-06',
      depositScheduleRows: [],
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-07', weekNo: 2 } },
    });

    expect(checks.find((check) => check.id === 'labor-transfer')).toEqual({
      id: 'labor-transfer',
      status: 'WARNING',
      title: 'MYSC 인건비 이관',
      detail: '2026-06 3주차 · Projection 인건비 미기입 · 1주차 10원, 2주차 10원, 4주차 10원, 5주차 10원 입력됨',
      findings: ['2026-06 3주차 · Projection 인건비 미기입 · 1주차 10원, 2주차 10원, 4주차 10원, 5주차 10원 입력됨'],
    });
  });

  it('monitors labor and post-deposit transfers across the full pinned project period', () => {
    const { documents } = fullMonthCloseSource();
    const mirror = documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    const juneCells = mirror.cells.map((cell) => (
      cell.mode === 'actual' && cell.weekNo === 3 && cell.lineId === 'MYSC_LABOR_OUT'
        ? { ...cell, amount: 10 }
        : cell
    ));
    const julyCells = juneCells.map((cell) => ({
      ...cell,
      yearMonth: '2026-07',
      state: cell.mode === 'projection' && cell.weekNo === 3 && cell.lineId === 'MYSC_LABOR_OUT' ? 'EMPTY' : cell.state,
      amount: cell.mode === 'actual' && cell.weekNo === 2 && ['MYSC_PROFIT_OUT', 'SALES_VAT_OUT'].includes(cell.lineId) ? 0 : cell.amount,
    }));
    const currentCells = juneCells.map(({ lineId, state, yearMonth: _yearMonth, direction: _direction, ...cell }) => ({
      ...cell, cashflowLine: lineId, cellState: state,
    }));
    const checks = buildCashflowManagementChecks({
      cashflow: { readModel: { months: [] } },
      cells: currentCells,
      yearMonth: '2026-06',
      pinnedSheetCells: [...juneCells, ...julyCells],
      depositScheduleRows: [{
        yearMonth: '2026-07', weekNo: 1, actualDepositDate: '2026-07-01', actualDepositAmount: 1_000_000,
      }],
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-08', weekNo: 3 } },
    });

    expect(checks.find((check) => check.id === 'labor-transfer')?.detail).toContain('2026-07 3주차 · Projection 인건비 미기입');
    expect(checks.find((check) => check.id === 'profit-vat-after-deposit')?.detail).toContain('2026-07 2주차 MYSC 수익·매출부가세');
  });

  it('uses the canonical JVM ledger instead of an unapplied pinned sheet for negative Projection balance', () => {
    const { documents } = fullMonthCloseSource();
    const mirror = documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    const pinnedSheetCells = mirror.cells.map((cell) => ({
      ...cell,
      amount: cell.lineId === 'MYSC_PREPAY_IN' || cell.lineId === 'DIRECT_COST_OUT' ? 100 : 0,
    }));
    const cells = pinnedSheetCells.map(({ lineId, state, yearMonth: _yearMonth, direction: _direction, ...cell }) => ({
      ...cell,
      cashflowLine: lineId,
      cellState: state,
    }));
    const checks = buildCashflowManagementChecks({
      project: {},
      cashflow: {
        readModel: {
          months: [{
            yearMonth: '2024-09',
            projection: { weeks: [{ weekNo: 2, amounts: { DIRECT_COST_OUT: 1_293_296 } }] },
            actual: { weeks: [] },
          }],
        },
      },
      cells,
      yearMonth: '2026-06',
      pinnedSheetCells,
      depositScheduleRows: [],
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-06', weekNo: 5 } },
    });

    expect(checks.find((check) => check.id === 'negative-projection-balance')).toMatchObject({
      id: 'negative-projection-balance',
      status: 'WARNING',
      title: 'Projection 잔액 마이너스',
      findings: [expect.stringContaining('2024-09 2주차')],
    });
  });

  it('starts the negative Projection check from the prior-year opening balance', () => {
    const checks = buildCashflowManagementChecks({
      cashflow: {
        readModel: {
          months: [{
            yearMonth: '2026-01',
            projection: { weeks: [{ weekNo: 1, amounts: { DIRECT_COST_OUT: 2_000_000 } }] },
            actual: { weeks: [] },
          }],
        },
      },
      cells: [],
      yearMonth: '2026-01',
      depositScheduleRows: [],
      projectionOpeningBalance: 2_000_000,
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-01', weekNo: 5 } },
    });

    expect(checks.find((check) => check.id === 'negative-projection-balance')).toMatchObject({
      status: 'OK',
      detail: 'Projection 누적 잔액이 0원 이상입니다.',
    });
  });

  it('uses the JVM-provided opening balance instead of recalculating annual totals in the BFF', async () => {
    const { db, documents } = fullMonthCloseSource();
    documents.get('orgs/tenant-a/projects/project-a').contractStart = '2025-01-01';
    documents.get('orgs/tenant-a/projects/project-a').contractEnd = '2026-12-31';
    const mirror = documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    mirror.appliedAnnualYears = [2025];
    mirror.appliedWeeklyYears = [2026];
    const annualId = Buffer.from('project-a\n2025', 'utf8').toString('base64url');
    documents.set(`orgs/tenant-a/cashflow_sheet_year_totals/${annualId}`, {
      projectId: 'project-a',
      year: 2025,
      projection: { SALES_IN: 9_000_000 },
      projectionStates: { SALES_IN: 'VALUE' },
      actual: { SALES_IN: 8_000_000 },
      actualStates: { SALES_IN: 'VALUE' },
    });
    const jvmOpeningBalances = {
      selectedYear: 2026,
      projection: annualOpeningMode('SALES_IN', 2_000_000),
      actual: annualOpeningMode('SALES_IN', 1_800_000),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource(
        {
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        },
        undefined,
        jvmOpeningBalances,
      )),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.openingBalances).toEqual(jvmOpeningBalances);
      });
  });

  it('keeps prior weekly running net and selected-year range in the dashboard fallback read model', async () => {
    const { db } = fullMonthCloseSource();
    const cashflow = {
      projectId: 'project-a',
      projection: [],
      actual: [],
      readModel: {
        months: [
          {
            yearMonth: '2025-12',
            projection: { weeks: [{ weekNo: 5, amounts: { SALES_IN: 3_000_000 }, net: 3_000_000 }] },
            actual: { weeks: [] },
          },
          {
            yearMonth: '2026-01',
            projection: { weeks: [{ weekNo: 2, amounts: { DIRECT_COST_OUT: 500_000 }, net: 2_500_000 }] },
            actual: { weeks: [] },
          },
        ],
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      }, cashflow, projectionOpeningBalance('TEAM_SUPPORT_IN'))),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.canonical.months[0].projection.weeks[0].net).toBe(3_000_000);
        expect(response.body.dashboard.canonical.range).toMatchObject({
          start: { yearMonth: '2026-01', weekNo: 1 },
          end: { yearMonth: '2026-12', weekNo: 5 },
          projection: { totalIn: 0, totalOut: 500_000, net: -500_000 },
        });
      });
  });

  it('returns an empty usable dashboard when the project has no linked sheet', async () => {
    const documents = new Map([
      ['orgs/tenant-a/projects/project-a', { id: 'project-a', contractAmount: 1000 }],
    ]);
    const db = {
      doc: (path) => ({
        get: async () => {
          const value = documents.get(path);
          return { exists: value !== undefined, data: () => value };
        },
      }),
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard).toMatchObject({
          source: { status: 'EMPTY' },
          cells: [],
          totals: {
            projection: { totalIn: 0, totalOut: 0, balance: 0 },
            actual: { totalIn: 0, totalOut: 0, balance: 0 },
          },
        });
        expect(response.body.dashboard.totals.projection.weeks).toHaveLength(5);
        expect(response.body.dashboard.totals.actual.weeks).toHaveLength(5);
        expect(response.body.dashboard.validation.blockers).toContainEqual(expect.objectContaining({
          code: 'SHEET_SOURCE_REQUIRED',
        }));
      });
  });

  it('bounds the month-close JVM proxy before the browser deadline', async () => {
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db: createMonthCloseDb(),
      jvmWeeklyApiTimeoutMs: 5,
    });
    const startedAt = Date.now();

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(503)
      .expect((response) => expect(response.body).toMatchObject({ code: 'jvm_weekly_api_unreachable' }));

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('ignores obsolete private-draft confirmations when reading an open month', async () => {
    const { db, documents } = fullMonthCloseSource();
    const draft = [...documents.values()].find((value) => value?.resourceType === 'cashflow');
    const confirmations = draft.payload.monthClose.confirmations;
    confirmations[confirmations.length - 1] = { ...confirmations[0] };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.summary.confirmationProgressPercent).toBe(0);
        expect(response.body.dashboard.validation).toMatchObject({ canClose: true });
        expect(response.body.dashboard.confirmations).toEqual([]);
      });
  });

  it('shows Projection overage and keeps the zero-contract rule', async () => {
    for (const contractAmount of [100, 0]) {
      const { db } = fullMonthCloseSource({ contractAmount });
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })),
      }));
      const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
        env: stageEnv,
        db,
        now: () => new Date('2026-07-10T00:00:00.000Z'),
      });

      await request(app)
        .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
        .expect(200)
        .expect((response) => {
          expect(response.body.dashboard.summary.projectionProgressPercent).toBe(contractAmount === 0 ? 100 : 350);
        });
    }
  });

  it('adds future annual Projection until that year has a weekly ledger', async () => {
    const { db, documents } = fullMonthCloseSource({ contractAmount: 1000 });
    const project = documents.get('orgs/tenant-a/projects/project-a');
    project.contractStart = '2026-01-01';
    project.contractEnd = '2027-12-31';
    const mirror = documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    mirror.appliedAnnualYears = [2027];
    mirror.appliedWeeklyYears = [2026];
    mirror.sheetFacts.annualCashflowTotals = [{
      year: 2027,
      projection: { totalIn: 650 },
      actual: { totalIn: 0 },
    }];
    const cashflow = {
      projectId: 'project-a',
      readModel: {
        months: [{
          yearMonth: '2026-06',
          projection: { weeks: [{ weekNo: 1, amounts: { SALES_IN: 350 } }] },
          actual: { weeks: [] },
        }],
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      }, cashflow)),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.summary).toMatchObject({
          projectionProgressPercent: 100,
          projectionTotalIn: 1000,
          projectionContractAmount: 1000,
          projectionYears: [
            { year: 2026, source: 'WEEKLY' },
            { year: 2027, source: 'ANNUAL', totalIn: 650 },
          ],
        });
        expect(response.body.dashboard.validation.warnings).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'CONTRACT_PROJECTION_MISMATCH' }),
        ]));
      });
  });

  it('uses the CLOSED snapshot instead of current project or mirror values', async () => {
    const current = fullMonthCloseSource();
    const weeklyTotals = Array.from({ length: 5 }, (_, index) => ({
      weekNo: index + 1,
      projection: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, 20])),
      actual: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, 10])),
    }));
    const previousWeeklyTotals = weeklyTotals.map((week, index) => ({
      ...week,
      projection: index === 0 ? { ...week.projection, SALES_IN: 19 } : week.projection,
    }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1,
        reopenCount: 0, projectWarningCount: 0,
        previousSnapshot: { weeklyTotals: previousWeeklyTotals },
        snapshot: {
          project: { settlementType: 'TYPE5', basis: '공급가액', accountType: 'DEDICATED', contractAmount: 2000 },
          sourceFingerprint: `sha256:${'f'.repeat(64)}`,
          targetRevision: `sha256:${'a'.repeat(64)}`,
          sourceReadAt: '2026-07-09T00:00:00.000Z',
          weeklyTotals,
          ledgerWeeks: weeklyTotals.map((week) => ({
            yearMonth: '2026-06',
            weekNo: week.weekNo,
            projection: week.projection,
            actual: week.actual,
          })),
          reopenContext: { request: { reason: '입금 반영 오류 수정' }, decision: { reason: '증빙 확인 완료' } },
          depositScheduleRows: [], confirmations: [],
          sheetFacts: { metadata: { businessType: { value: 'snapshot metadata' } }, depositScheduleRows: [] },
        },
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: current.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard).toMatchObject({
          source: { kind: 'MONTH_CLOSE_SNAPSHOT', sourceRevision: `sha256:${'f'.repeat(64)}` },
          project: { settlementType: 'TYPE5', contractAmount: 2000 },
          sheetMetadata: { businessType: { value: 'snapshot metadata' } },
          sheetControlTotals: { deposit: null, unpaid: null },
          totals: {
            projection: { totalIn: 700, totalOut: 900, balance: -200 },
            actual: { totalIn: 350, totalOut: 450, balance: -100 },
          },
          canonical: {
            range: {
              projection: { totalIn: 700, totalOut: 900, net: -200 },
              actual: { totalIn: 350, totalOut: 450, net: -100 },
            },
            months: [expect.objectContaining({
              yearMonth: '2026-06',
              comparison: expect.objectContaining({ yearMonth: '2026-06' }),
            })],
          },
          validation: { canClose: false },
          postCloseAdjustment: {
            reason: '입금 반영 오류 수정',
            changedCount: 1,
            changes: [{ mode: 'projection', weekNo: 1, cashflowLine: 'SALES_IN', beforeAmount: 19, afterAmount: 20 }],
          },
        });
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves a legacy CLOSED snapshot as evidence-only without falling back to live ledger data', async () => {
    const legacyMonthClose = {
      ok: true,
      projectId: 'project-a',
      yearMonth: '2026-06',
      status: 'CLOSED',
      revision: 1,
      reopenCount: 0,
      projectWarningCount: 0,
      snapshot: {
        project: { contractAmount: 1000 },
        weeklyTotals: [{
          weekNo: 1,
          projection: { SALES_IN: 1000 },
          actual: { SALES_IN: 900 },
        }],
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource(
        legacyMonthClose,
        null,
        null,
        { status: 'LEGACY_EVIDENCE_ONLY', missingEvidence: ['OPENING_BALANCES', 'LEDGER_WEEKS'] },
      )),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: createMonthCloseDb() });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.openingBalances).toBeNull();
        expect(response.body.dashboard.canonical).toBeNull();
        expect(response.body.dashboard.snapshotCompatibility).toEqual({
          status: 'LEGACY_EVIDENCE_ONLY',
          missingEvidence: ['OPENING_BALANCES', 'LEDGER_WEEKS'],
        });
        expect(response.body.dashboard.totals.projection.weeks[0]).toMatchObject({ weekNo: 1, totalIn: 1000 });
        expect(response.body.dashboard.validation.warnings).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'LEGACY_CLOSE_EVIDENCE_LIMITED' }),
        ]));
      });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports stale and control-total mismatch blockers and refuses final close', async () => {
    for (const source of [
      fullMonthCloseSource({ mirrorStatus: 'STALE' }),
      fullMonthCloseSource({ controlMatches: false }),
    ]) {
      const fetchImpl = vi.fn(async (url) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source') ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        }) : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED' }),
      }));
      const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });

      const read = await request(app)
        .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
        .expect(200);
      expect(read.body.dashboard.validation.canClose).toBe(false);
      expect(read.body.dashboard.validation.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
        read.body.dashboard.source.status === 'STALE'
          ? 'SHEET_SOURCE_STALE'
          : 'SHEET_CONTROL_TOTAL_MISMATCH',
      ]));
      const closeInput = {
        ...source.closeInput,
        managementChecks: read.body.dashboard.managementChecks,
      };

      await request(app)
        .post('/api/v1/cashflow/project-a/month-close')
        .set('idempotency-key', `blocked-${read.body.dashboard.source.status}`)
        .send({
          yearMonth: '2026-06',
          expectedRevision: 0,
          expectedOpeningBalances: read.body.dashboard.openingBalances,
          closeInput,
        })
        .expect(409);
    }
  });

  it('blocks month close when the pinned sheet total does not equal its item values', async () => {
    const source = fullMonthCloseSource({ calculationMismatch: true });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.validation.canClose).toBe(false);
        expect(response.body.dashboard.validation.blockers).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'SHEET_CALCULATION_MISMATCH' }),
        ]));
      });
  });

  it('requires explicit reviewed close input before forwarding a month close', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
    }, { env: stageEnv, db: createMonthCloseDb() });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-no-input')
      .send({ yearMonth: '2026-06', expectedRevision: 0 })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_month_close_request_invalid');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a same-net opening row change that happened after the user review', async () => {
    const source = fullMonthCloseSource();
    const reviewed = projectionOpeningBalance('SALES_IN');
    const current = projectionOpeningBalance('TEAM_SUPPORT_IN');
    let dashboardReadCount = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (url.includes('/dashboard-source')) {
        dashboardReadCount += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(monthDashboardSource({
            ok: true,
            projectId: 'project-a',
            yearMonth: '2026-06',
            status: 'OPEN',
            revision: 0,
            reopenCount: 0,
            projectWarningCount: 0,
            snapshot: {},
          }, undefined, dashboardReadCount === 1 ? reviewed : current)),
        };
      }
      throw new Error('Month close mutation must not run after opening-balance drift.');
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db: source.db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });

    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    const closeInput = {
      ...source.closeInput,
      managementChecks: read.body.dashboard.managementChecks,
    };

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-opening-row-drift')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput,
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_opening_balance_stale');
      });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a sparse JVM annual opening source before dashboard composition', async () => {
    const source = fullMonthCloseSource();
    const sparse = projectionOpeningBalance('SALES_IN');
    sparse.projection.sources[0].lineStates = { SALES_IN: 'VALUE' };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true,
        projectId: 'project-a',
        yearMonth: '2026-06',
        status: 'OPEN',
        revision: 0,
        reopenCount: 0,
        projectWarningCount: 0,
        snapshot: {},
      }, undefined, sparse)),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(502)
      .expect((response) => {
        expect(response.body.code).toBe('jvm_weekly_opening_balance_invalid');
      });
  });

  it('bounds slow Firestore composition inside the full month-close route deadline', async () => {
    const fetchImpl = vi.fn();
    const stalledDb = {
      doc: () => ({ get: () => new Promise(() => {}) }),
    };
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db: stalledDb,
      cashflowMonthCloseRouteTimeoutMs: 20,
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(504)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_month_close_route_timeout');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never starts the final JVM close mutation after the preflight deadline', async () => {
    const fetchImpl = vi.fn();
    const stalledDb = {
      doc: () => ({ get: () => new Promise(() => {}) }),
    };
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: stageEnv,
      db: stalledDb,
      cashflowMonthCloseRouteTimeoutMs: 30,
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-stalled-preflight')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedOpeningBalances: { selectedYear: 2026 },
        closeInput: { yearMonth: '2026-06' },
      })
      .expect(504)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_month_close_route_timeout');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['viewer', 'pm', 'finance', 'admin'])('forwards a reviewed %s month close without edit-lease headers', async (actorRole) => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : init.method === 'GET'
          ? { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: `${actorRole}-1`,
      actorRole,
    }, { env: stageEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });

    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    const closeInput = {
      ...source.closeInput,
      managementChecks: read.body.dashboard.managementChecks,
    };

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', `month-close-${actorRole}`)
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        yearMonth: '2026-06',
        expectedRevision: 3,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput,
      })
      .expect(200);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[2];
    expect(url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a/month-close');
    expect(init.headers).toMatchObject({
      'x-actor-id': `${actorRole}-1`,
      'x-actor-role': actorRole,
      'x-data-project-id': 'stage-data-project',
    });
    expect(init.headers['x-edit-session-id']).toBeUndefined();
    expect(init.headers['x-edit-finalize']).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({
      idempotencyKey: `month-close-${actorRole}`,
      yearMonth: '2026-06',
      expectedRevision: 3,
      expectedDraftRevision: 0,
      sourceRevision: `sha256:${'c'.repeat(64)}`,
      targetRevision: `sha256:${'d'.repeat(64)}`,
      openingBalances: {
        selectedYear: 2026,
        projection: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
        actual: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
      },
    });
    expect(JSON.parse(init.body).cells).toHaveLength(160);
    expect(JSON.parse(init.body)).not.toHaveProperty('tenantId');
    expect(JSON.parse(init.body)).not.toHaveProperty('actor');
  });

  it('retries the same explicit close request without consulting a private draft', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 3,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : init.method === 'GET'
          ? { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 4 }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: stageEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });

    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    const payload = {
      yearMonth: '2026-06',
      expectedRevision: 3,
      expectedOpeningBalances: read.body.dashboard.openingBalances,
      closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app)
        .post('/api/v1/cashflow/project-a/month-close')
        .set('idempotency-key', 'month-close-retry-1')
        .send(payload)
        .expect(200);
    }

    const closeBodies = fetchImpl.mock.calls
      .filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')
      .map(([, init]) => JSON.parse(init.body));
    expect(closeBodies).toHaveLength(2);
    expect(closeBodies[1]).toEqual(closeBodies[0]);
    expect(closeBodies[0]).toMatchObject({ idempotencyKey: 'month-close-retry-1', expectedDraftRevision: 0 });
  });

  it('forwards PM reopen requests without edit-lease headers', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        projectId: 'project-a',
        yearMonth: '2026-06',
        status: 'REOPEN_REQUESTED',
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
    }, { env: { ...stageEnv, BFF_EDIT_LEASES_ENABLED: 'false' } });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/reopen-request')
      .set('idempotency-key', 'month-reopen-request-1')
      .send({ yearMonth: '2026-06', expectedRevision: 4, reason: '증빙 정정 필요' })
      .expect(200);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a/month-close/reopen-request');
    expect(init.headers['x-edit-session-id']).toBeUndefined();
    expect(init.headers['x-edit-lease-id']).toBeUndefined();
    expect(init.headers['x-edit-fence']).toBeUndefined();
    expect(init.headers['x-data-project-id']).toBe('stage-data-project');
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'month-reopen-request-1',
      yearMonth: '2026-06',
      expectedRevision: 4,
      reason: '증빙 정정 필요',
    });
  });

  it.each(['admin', 'finance'])(
    'forwards %s reopen decisions without edit-lease headers',
    async (actorRole) => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          projectId: 'project-a',
          yearMonth: '2026-06',
          status: 'OPEN',
        }),
      }));
      const { app } = createApp(fetchImpl, createIdempotencyService(), {
        actorId: `${actorRole}-1`,
        actorRole,
      }, { env: stageEnv });

      await request(app)
        .post('/api/v1/cashflow/project-a/month-close/reopen-decision')
        .set('idempotency-key', `month-reopen-decision-${actorRole}`)
        .send({ yearMonth: '2026-06', expectedRevision: 5, decision: 'APPROVE', reason: '확인 완료' })
        .expect(200);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a/month-close/reopen-decision');
      expect(init.headers['x-actor-role']).toBe(actorRole);
      expect(init.headers['x-edit-session-id']).toBeUndefined();
      expect(init.headers['x-data-project-id']).toBe('stage-data-project');
      expect(JSON.parse(init.body)).toMatchObject({
        idempotencyKey: `month-reopen-decision-${actorRole}`,
        yearMonth: '2026-06',
        expectedRevision: 5,
        decision: 'APPROVE',
      });
    },
  );

  it.each([
    [{ ...stageEnv, BFF_DEPLOY_ENV: 'live' }, 'unsafe_bff_runtime'],
    [{ ...stageEnv, JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'other-data-project' }, 'jvm_weekly_data_project_mismatch'],
  ])('blocks reopen writes before the JVM when the Stage data guard fails', async (env, code) => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/reopen-request')
      .set('idempotency-key', `blocked-reopen-${code}`)
      .send({ yearMonth: '2026-06', expectedRevision: 4, reason: '정정 필요' })
      .expect(503)
      .expect((response) => expect(response.body.code).toBe(code));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['pm', '/api/v1/cashflow/project-a/month-close/reopen-decision'],
  ])('rejects %s from forbidden month-close route %s before the JVM', async (actorRole, path) => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: `${actorRole}-1`,
      actorRole,
    }, { env: stageEnv });

    await request(app)
      .post(path)
      .set({
        'idempotency-key': `forbidden-${actorRole}`,
        ...editLeaseHeaders,
        'x-edit-finalize': 'true',
      })
      .send({ yearMonth: '2026-06' })
      .expect(403);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['1', 'TRUE', 'yes', 'false'])(
    'ignores obsolete cashflow edit finalization value %s',
    async (finalize) => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      }));
      const { app } = createApp(fetchImpl, createIdempotencyService(), {
        actorId: 'admin-1', actorRole: 'admin',
      }, { env: stageEnv });

      await request(app)
        .post('/api/v1/cashflow-metadata/project-a/variance')
        .set({
          'idempotency-key': `bad-finalize-${finalize}`,
          ...editLeaseHeaders,
          'x-edit-finalize': finalize,
        })
        .send({ yearMonth: '2026-07', weekNo: 1, reason: 'test' })
        .expect(200);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][1].headers['x-edit-finalize']).toBeUndefined();
    },
  );

  it.each(['0', '-1', '01', '1e2', '1.0', '9007199254740992'])(
    'rejects non-canonical edit fence %s before the JVM',
    async (fence) => {
      const fetchImpl = vi.fn();
      const { app } = createApp(fetchImpl, createIdempotencyService(), {
        actorId: 'admin-1',
        actorRole: 'admin',
      }, { env: stageEnv });

      await request(app)
        .post('/api/v1/weekly-expenses/project-a/sheets/default/save-draft')
        .set({
          'idempotency-key': `bad-fence-${fence}`,
          ...editLeaseHeaders,
          'x-edit-fence': fence,
        })
        .send({})
        .expect(400);

      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('rejects direct Projection writes and keeps Google Sheet import as the only user write path', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1',
      actorRole: 'finance',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/cashflow/project-a/projection')
      .send({ lines: [{ yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }] })
      .expect(410)
      .expect((response) => expect(response.body.code).toBe('cashflow_projection_sheet_import_only'));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards only trusted context headers and strips client actor/tenant body fields', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch')
      .set({ 'idempotency-key': 'idem-proxy-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
      'x-actor-email': 'pm@example.com',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-proxy-1',
      cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
    });
  });

  it('does not use BFF Firestore idempotency for Java-owned commands', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    const idempotencyService = createIdempotencyService();
    idempotencyService.begin.mockImplementation(async () => {
      throw new Error('BFF idempotency must not run for Java weekly commands');
    });
    const { app } = createApp(fetchImpl, idempotencyService, {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch')
      .set({ 'idempotency-key': 'idem-java-owned-1', ...editLeaseHeaders })
      .send({
        cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
      })
      .expect(200);

    expect(idempotencyService.begin).not.toHaveBeenCalled();
    expect(idempotencyService.complete).not.toHaveBeenCalled();
    expect(idempotencyService.fail).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('proxies server clipboard copy commands through the Java API', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          commandName: 'weeklyExpense.cells.copy',
          clipboard: { operationType: 'COPY', rowCount: 1, columnCount: 2, cells: [] },
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/copy')
      .set({ 'idempotency-key': 'idem-copy-1', ...editLeaseHeaders })
      .send({
        expectedSheetVersion: 3,
        startRow: 0,
        startColumn: 3,
        endRow: 0,
        endColumn: 4,
        depth: 'DEEP',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.commandName).toBe('weeklyExpense.cells.copy');
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default/commands/copy');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-copy-1',
      expectedSheetVersion: 3,
      startRow: 0,
      startColumn: 3,
      endRow: 0,
      endColumn: 4,
      depth: 'DEEP',
    });
  });

  it('proxies cashflow snapshot reads with trusted tenant context and embeds the binding comparison read model', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a',
          projection: [],
          actual: [],
          readModel: {
            months: [{
              yearMonth: '2026-01',
              projection: { weeks: [{ weekNo: 1, amounts: { SALES_IN: 1000 } }] },
              actual: { weeks: [{ weekNo: 1, amounts: { SALES_IN: 700 } }] },
            }],
          },
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/cashflow/project-a?asOf=2026-01-31&rangeStart=2026-01%3A1&rangeEnd=2026-01%3A1')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a' });
        expect(response.body.comparison).toMatchObject({
          direction: 'projection_minus_actual',
          asOfDate: '2026-01-31',
          asOfWeek: { yearMonth: '2026-01', weekNo: 5 },
          months: [{
            yearMonth: '2026-01',
            weeks: [{
              weekNo: 1,
              amounts: { SALES_IN: 300 },
              totalIn: 300,
              totalOut: 0,
              net: 300,
              lines: expect.arrayContaining([
                expect.objectContaining({ lineId: 'SALES_IN', projection: 1000, actual: 700, difference: 300 }),
              ]),
            }],
          }],
        });
        expect(response.body.readModel.months[0].comparison).toMatchObject({
          weeks: [{
            weekNo: 1,
            amounts: { SALES_IN: 300 },
            totalIn: 300,
            totalOut: 0,
            net: 300,
            lines: expect.arrayContaining([
              expect.objectContaining({ lineId: 'SALES_IN', projection: 1000, actual: 700, difference: 300 }),
            ]),
          }],
          rowTotals: { SALES_IN: 300 },
          totalIn: 300,
          totalOut: 0,
          net: 300,
        });
        expect(response.body.readModel.range).toMatchObject({
          start: { yearMonth: '2026-01', weekNo: 1 },
          end: { yearMonth: '2026-01', weekNo: 1 },
          projection: { rowTotals: { SALES_IN: 1000 }, totalIn: 1000, totalOut: 0, net: 1000 },
          actual: { rowTotals: { SALES_IN: 700 }, totalIn: 700, totalOut: 0, net: 700 },
        });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a');
    expect(calls[0].init.headers['x-inner-platform-service-token']).toBe('test-service-token');
    expect(calls[0].init.headers['x-tenant-id']).toBe('tenant-a');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('rejects a mismatched JVM cashflow snapshot project before returning data', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        projectId: 'project-b',
        readModel: { months: [] },
      }),
    }));
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/cashflow/project-a?asOf=2026-01-31')
      .expect(502)
      .expect((response) => {
        expect(response.body.code).toBe('jvm_weekly_project_mismatch');
      });
  });

  it('rejects an invalid cashflow comparison as-of date before calling the JVM', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/cashflow/project-a?asOf=2026-02-30')
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_comparison_as_of_invalid');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid or reversed cashflow total ranges before calling the JVM', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/cashflow/project-a?rangeStart=2026-1%3A1&rangeEnd=2026-12%3A5')
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_range_invalid');
      });

    await request(app)
      .get('/api/v1/cashflow/project-a?rangeStart=2026-12%3A5&rangeEnd=2026-01%3A1')
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_range_invalid');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults cashflow comparison as-of to the current Seoul date', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        projectId: 'project-a',
        readModel: {
          months: [{
            yearMonth: '2026-06',
            projection: {
              weeks: [
                { weekNo: 3, amounts: { SALES_IN: 30 } },
                { weekNo: 4, amounts: { SALES_IN: 40 } },
              ],
            },
            actual: { weeks: [] },
          }],
        },
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      now: () => new Date('2026-06-14T15:30:00.000Z'),
    });

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200)
      .expect((response) => {
        expect(response.body.comparison).toMatchObject({
          asOfDate: '2026-06-15',
          asOfWeek: { yearMonth: '2026-06', weekNo: 3 },
        });
        expect(response.body.readModel.months[0].comparison.weeks.map((week) => week.weekNo)).toEqual([3]);
      });
  });

  it('proxies weekly expense sheet read-back through trusted Java context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a',
          sheetKey: 'default',
          rows: [{ id: 'row-1', cells: [] }],
          sheetVersion: 7,
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/sheets/default')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a', sheetKey: 'default', sheetVersion: 7 });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });

  it('proxies weekly expense sheet list reads for Java-backed portal hydration', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a',
          sheets: [{ sheetKey: 'default', rows: [], sheetVersion: 1 }],
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/sheets')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a', sheets: [{ sheetKey: 'default', sheetVersion: 1 }] });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('adds a Google identity token when the Java Cloud Run audience is configured', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (String(url).startsWith('http://metadata.google.internal/')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'metadata-id-token',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ projectId: 'project-a', projection: [], actual: [] }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      jvmWeeklyApiIdTokenAudience: 'https://innerplatform-jvm-weekly-api.run.app',
    });

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('metadata.google.internal');
    expect(calls[0].url).toContain('audience=https%3A%2F%2Finnerplatform-jvm-weekly-api.run.app');
    expect(calls[0].init.headers).toMatchObject({ 'Metadata-Flavor': 'Google' });
    expect(calls[1].url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a');
    expect(calls[1].init.headers.authorization).toBe('Bearer metadata-id-token');
    expect(calls[1].init.headers['x-inner-platform-service-token']).toBe('test-service-token');
  });

  it('adds an audience-bound ID token resolved from Stage BFF credentials', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ projectId: 'project-a', projection: [], actual: [] }),
      };
    });
    const resolveIdentityToken = vi.fn(async () => 'stage-id-token');
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      jvmWeeklyApiIdTokenAudience: 'https://innerplatform-jvm-weekly-api-lease-stage.a.run.app',
      jvmWeeklyApiServiceAccountJson: JSON.stringify({ client_email: 'stage-invoker@example.iam.gserviceaccount.com' }),
      jvmWeeklyApiIdentityTokenResolver: resolveIdentityToken,
    });

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200);

    expect(resolveIdentityToken).toHaveBeenCalledWith(expect.objectContaining({
      audience: 'https://innerplatform-jvm-weekly-api-lease-stage.a.run.app',
      serviceAccountJson: JSON.stringify({ client_email: 'stage-invoker@example.iam.gserviceaccount.com' }),
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.authorization).toBe('Bearer stage-id-token');
  });

  it('proxies audit export creation as a finance-only Java command', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1',
      actorRole: 'finance',
      actorEmail: 'finance@example.com',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-export-1')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        format: 'CSV',
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/audit-export');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'finance-1',
      'x-actor-role': 'finance',
      'x-actor-email': 'finance@example.com',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-export-1',
      format: 'CSV',
    });
  });

  it('preserves real Java roles for mysc users when JVM auth mode is strict', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-mysc-1',
      actorRole: 'finance',
      actorEmail: 'finance@mysc.co.kr',
      actorName: '재무 사용자',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-strict-mysc-export-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'x-actor-id': 'finance-mysc-1',
      'x-actor-role': 'finance',
      'x-actor-email': 'finance@mysc.co.kr',
      'x-actor-name': encodeURIComponent('재무 사용자'),
    });
  });

  it('does not relax finance-only Java weekly routes for workspace users in strict mode', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'viewer-mysc-1',
      actorRole: 'viewer',
      actorEmail: 'viewer@mysc.co.kr',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-strict-viewer-export-1')
      .send({ format: 'CSV' })
      .expect(403);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets mysc workspace users run scoped Java weekly commands when JVM auth mode is workspace', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(
      fetchImpl,
      createIdempotencyService(),
      {
        actorId: 'workspace-1',
        actorRole: 'viewer',
        actorEmail: 'workspace@mysc.co.kr',
        actorName: '민욱 사용자',
      },
      { jvmWeeklyAuthMode: 'internal_saas_workspace' },
    );

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-workspace-export-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/audit-export');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'workspace-1',
      'x-actor-role': 'workspace_user',
      'x-actor-email': 'workspace@mysc.co.kr',
      'x-actor-name': encodeURIComponent('민욱 사용자'),
    });
  });

  it('uses the configured workspace email domain when relaxing Java weekly roles', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(
      fetchImpl,
      createIdempotencyService(),
      {
        actorId: 'workspace-2',
        actorRole: 'viewer',
        actorEmail: 'workspace@example.org',
      },
      {
        jvmWeeklyAuthMode: 'internal_saas_workspace',
        jvmWeeklyWorkspaceEmailDomain: 'example.org',
      },
    );

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-workspace-export-custom-domain-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'x-actor-id': 'workspace-2',
      'x-actor-role': 'workspace_user',
      'x-actor-email': 'workspace@example.org',
    });
  });

  it('disables the legacy weekly submit command in favor of month close', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.submitWeek', state: 'submitted' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
    }, { env: stageEnv });
    await request(app)
      .post('/api/v1/weekly-expenses/project-a/submit')
      .set({ 'idempotency-key': 'idem-submit-compound-1', ...editLeaseHeaders, 'x-edit-finalize': 'true' })
      .send({ yearMonth: '2026-06', weekNo: 1 })
      .expect(410)
      .expect((response) => {
        expect(response.body.code).toBe('weekly_close_disabled_use_month_close');
      });

    expect(calls).toHaveLength(0);
  });

  it('disables the legacy weekly close command in favor of month close', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.closeWeek', state: 'closed' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
      actorEmail: 'admin@example.com',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/close')
      .set({ 'idempotency-key': 'idem-close-1', ...editLeaseHeaders, 'x-edit-finalize': 'true' })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        yearMonth: '2026-06',
        weekNo: 1,
        projectionLines: [{ yearMonth: '2026-06', weekNo: 1, cashflowLine: 'SALES_IN', amount: 2500 }],
      })
      .expect(410)
      .expect((response) => {
        expect(response.body.code).toBe('weekly_close_disabled_use_month_close');
      });

    expect(calls).toHaveLength(0);
  });

  it('proxies bank statement import and apply commands through trusted Java context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/bank-statements/import-batch')
      .set({ 'idempotency-key': 'idem-bank-import-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        columns: ['거래일시', '금액'],
        lines: [{ lineIndex: 0, sourceLineKey: 'bank:1', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] }],
      })
      .expect(200);

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/bank-statements/apply-items')
      .set({ 'idempotency-key': 'idem-bank-apply-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        sheetKey: 'default',
        items: [{ importLineId: 'line-1', cells: [{ columnIndex: 8, rawValue: '사업비' }] }],
      })
      .expect(200);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/import-batch');
    expect(calls[1].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/apply-items');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-bank-import-1',
      columns: ['거래일시', '금액'],
      lines: [{ lineIndex: 0, sourceLineKey: 'bank:1', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] }],
    });
    expect(JSON.parse(calls[1].init.body)).toEqual({
      idempotencyKey: 'idem-bank-apply-1',
      sheetKey: 'default',
      items: [{ importLineId: 'line-1', cells: [{ columnIndex: 8, rawValue: '사업비' }] }],
    });
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });

  it('proxies bank statement import line reads through trusted Java context without a request body', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          projectId: 'project-a',
          status: 'all',
          lines: [
            { id: 'line-1', sourceLineKey: 'bank:1', status: 'staged', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] },
          ],
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/bank-statements/import-lines?status=all')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.lines).toHaveLength(1);
        expect(response.body.lines[0].id).toBe('line-1');
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/import-lines?status=all');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });
});
