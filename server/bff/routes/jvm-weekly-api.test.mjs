import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildCashflowManagementChecks, cashflowMonthCloseDeadline, mountJvmWeeklyApiRoutes } from './jvm-weekly-api.mjs';

function createIdempotencyService() {
  return {
    begin: vi.fn(async () => ({ mode: 'new', requestFingerprint: 'fp' })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

const runtimeEnv = {
  BFF_DEPLOY_ENV: 'live',
  BFF_EDIT_LEASES_ENABLED: 'true',
  BFF_LIVE_FIREBASE_PROJECT_ID: 'live-data-project',
  VITE_FIREBASE_PROJECT_ID: 'live-data-project',
  JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'live-data-project',
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
  { id: 'labor-transfer', status: 'WARNING', title: 'MYSC 인건비 이관', detail: '2026-06 3주차 인건비 미입력' },
  { id: 'profit-vat-after-deposit', status: 'REVIEW_REQUIRED', title: '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)', detail: '실제 입금 확인 건이 없습니다. 해당 없음 여부를 사람이 확인해 주세요.' },
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
  projectionActualSummary = {
    projectId: monthClose.projectId,
    fromMonth: '2023-01',
    comparisonAsOfWeek: { yearMonth: '2026-07', weekNo: 2 },
    settlementDifferenceAmount: 18_371_453,
    settlementMatches: false,
  },
) {
  const liveCurrent = monthClose.status === 'OPEN' || snapshotCompatibility.status === 'LIVE_AMENDED';
  return {
    monthClose,
    cashflow: liveCurrent ? cashflow : null,
    openingBalances,
    snapshotCompatibility,
    projectionActualSummary,
    weeklyCompliance: { items: [], nextCursor: '', onTimeCount: 0, missedCount: 0 },
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

function memoryTransaction(documents) {
  return async (callback) => {
    const staged = new Map();
    const result = await callback({
      get: async (ref) => {
        if (!ref.path) return ref.get();
        const value = staged.has(ref.path) ? staged.get(ref.path) : documents.get(ref.path);
        return { exists: value !== undefined, data: () => value };
      },
      set: (ref, value, options) => {
        ref.beforeTransactionSet?.();
        staged.set(ref.path, options?.merge
          ? { ...(staged.get(ref.path) || documents.get(ref.path) || {}), ...value }
          : value);
      },
    });
    for (const [path, value] of staged) documents.set(path, value);
    return result;
  };
}

function memoryDoc(documents, path) {
  return {
    path,
    get: async () => {
      const value = documents.get(path);
      return { exists: value !== undefined, data: () => value };
    },
    set: async (value, options) => {
      documents.set(path, options?.merge ? { ...(documents.get(path) || {}), ...value } : value);
    },
  };
}

function fullMonthCloseSource({
  mirrorStatus = 'FRESH', controlMatches = true, calculationMismatch = false,
  contractAmount = 1000, explicitZero = false, explicitEmpty = false,
} = {}) {
  const sourceRevision = `sha256:${'c'.repeat(64)}`;
  const targetRevision = `sha256:${'d'.repeat(64)}`;
  const cells = [];
  const confirmations = [];
  for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
    for (const mode of ['projection', 'actual']) {
      for (const lineId of cashflowLineIds) {
        const zero = explicitZero && mode === 'projection' && weekNo === 1 && lineId === 'SALES_IN';
        const empty = explicitEmpty && mode === 'projection' && weekNo === 1 && lineId === 'BANK_INTEREST_IN';
        cells.push({
          mode, yearMonth: '2026-06', weekNo, lineId, direction: cashflowLineIds.indexOf(lineId) < 7 ? 'IN' : 'OUT',
          state: empty ? 'EMPTY' : zero ? 'ZERO' : 'VALUE',
          amount: empty ? null : zero ? 0 : (mode === 'projection' ? 10 : 5),
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
    humanReviewed: true,
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
    weeklyCalculationChecks: Array.from({ length: 10 }, (_, index) => ({
      mode: index < 5 ? 'projection' : 'actual',
      yearMonth: '2026-06',
      weekNo: (index % 5) + 1,
      sourceCells: {},
      matches: calculationMismatch && index === 0
        ? { depositTotal: false, withdrawalTotal: true, balance: true }
        : { depositTotal: true, withdrawalTotal: true, balance: true },
    })),
    issues: [],
  };
  const draftId = `v1_${Buffer.from(JSON.stringify(['cashflow', 'project-a', 'pm-1']), 'utf8').toString('base64url')}`;
  const documents = new Map([
    ['orgs/tenant-a/projects/project-a', {
      id: 'project-a', settlementType: 'TYPE1', basis: '공급가액', accountType: 'DEDICATED',
      fundInputMode: 'BANK_UPLOAD', contractAmount, executiveApproverId: 'finance-1',
    }],
    ['orgs/tenant-a/members/finance-1', { uid: 'finance-1', name: 'Finance One', role: 'viewer', status: 'ACTIVE', projectIds: ['project-a'] }],
    ['orgs/tenant-a/members/finance-2', { uid: 'finance-2', role: 'finance', status: 'ACTIVE', projectIds: ['project-a'] }],
    ['orgs/tenant-a/members/pm-1', { uid: 'pm-1', name: 'Project Manager', role: 'pm', status: 'ACTIVE', projectIds: ['project-a'] }],
    ['orgs/tenant-a/members/viewer-2', { uid: 'viewer-2', role: 'viewer', status: 'ACTIVE', projectIds: [] }],
    [`orgs/tenant-a/privateEditDrafts/${draftId}`, {
      tenantId: 'tenant-a', ownerUid: 'pm-1', resourceType: 'cashflow', resourceId: 'project-a',
      status: 'ACTIVE', draftRevision: 7,
      payload: { monthClose: closeInput },
    }],
    ['orgs/tenant-a/cashflow_sheet_mirrors/project-a', {
      projectId: 'project-a', status: mirrorStatus, sourceRevision, appliedSourceRevision: sourceRevision, targetRevisionAtFetch: targetRevision,
      spreadsheetId: 'spreadsheet-a', spreadsheetTitle: '2026 사업비 관리 시트', selectedSheetName: 'cashflow(사용내역 연동)',
      yearMonths: ['2026-06'], capturedAt: '2026-07-01T00:00:00.000Z', configRevision: `sha256:${'e'.repeat(64)}`,
      cells, sheetFacts,
    }],
  ]);
  return {
    db: {
      doc: (path) => memoryDoc(documents, path),
      runTransaction: memoryTransaction(documents),
      collection: (path) => ({
        where: (field, _operator, expected) => ({
          limit: () => ({
            get: async () => ({
              docs: [...documents.entries()]
                .filter(([documentPath, value]) => documentPath.startsWith(`${path}/`) && value[field] === expected)
                .map(([documentPath, value]) => ({ id: documentPath.split('/').at(-1), data: () => value })),
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
    doc: (path) => memoryDoc(documents, path),
    runTransaction: memoryTransaction(documents),
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
    fetchImpl: async (...args) => {
      if (String(args[0]).includes('/weekly-update-compliance') && routeOptions.forwardWeeklyComplianceFetch !== true) {
        const stub = typeof routeOptions.weeklyComplianceResponse === 'function'
          ? routeOptions.weeklyComplianceResponse()
          : routeOptions.weeklyComplianceResponse || { items: [], nextCursor: '', onTimeCount: 0, missedCount: 0 };
        return new Response(JSON.stringify(stub), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      const response = await fetchImpl(...args);
      if (response instanceof Response || response?.body) return response;
      return new Response(await response.text(), {
        status: response.status,
        headers: response.headers,
      });
    },
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
  it('forwards the canonical projection-actual batch summary unchanged', async () => {
    const canonical = {
      version: '1',
      items: [{
        projectId: 'project-a',
        fromMonth: '2023-01',
        comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 4 },
        settlementDifferenceAmount: 18_371_453,
        settlementMatches: false,
      }],
      errors: [{ projectId: 'project-b', code: 'SUMMARY_UNAVAILABLE' }],
    };
    const fetchImpl = vi.fn(async (_url, init) => new Response(JSON.stringify(canonical), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const { app } = createApp(fetchImpl);

    const response = await request(app)
      .post('/api/v1/cashflow/projection-actual-summary/batch')
      .send({ projectIds: ['project-a', 'project-b'] })
      .expect(200);

    expect(response.body).toEqual(canonical);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('http://jvm-weekly.local/api/v1/cashflow/projection-actual-summary/batch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ projectIds: ['project-a', 'project-b'] });
    expect(new Headers(init.headers).get('x-tenant-id')).toBe('tenant-a');
  });

  it('rejects projection-actual batch reads before JVM transport when the role is unauthorized', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'external' });

    await request(app)
      .post('/api/v1/cashflow/projection-actual-summary/batch')
      .send({ projectIds: ['project-a'] })
      .expect(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { projectIds: [] },
    { projectIds: Array.from({ length: 11 }, (_, index) => `project-${index}`) },
    { projectIds: ['project-a', 'project-a'] },
    { projectIds: ['project/a'] },
  ])('rejects an invalid projection-actual summary batch before JVM transport: %j', async (body) => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl);

    await request(app)
      .post('/api/v1/cashflow/projection-actual-summary/batch')
      .send(body)
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_projection_actual_summary_request_invalid');
      });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps canonical batch transport failures bounded', async () => {
    const fetchImpl = vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { jvmWeeklyApiTimeoutMs: 5 });

    await request(app)
      .post('/api/v1/cashflow/projection-actual-summary/batch')
      .send({ projectIds: ['project-a'] })
      .expect(503)
      .expect((response) => {
        expect(response.body.code).toBe('jvm_weekly_api_unreachable');
      });
  });

  it('rejects only weekly-expense writers before the JVM when their edit lease is missing', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
    }, { env: runtimeEnv });

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
    }, { env: runtimeEnv });

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
        'x-data-project-id': 'live-data-project',
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
    }, { env: runtimeEnv });

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
    }, { env: runtimeEnv });

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
      'x-data-project-id': 'live-data-project',
      'x-actor-role': 'finance',
    });
    expect(calls[0].init.headers['x-edit-session-id']).toBeUndefined();
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'variance-jvm-1',
      sheetId: 'week-a', expectedRevision: 2, action: 'FLAG', content: '입금 편차 확인',
    });
  });

  it('reads a cashflow month-close through the JVM with the requested yearMonth', async () => {
    const performanceEvents = [];
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
    }, { performanceLogger: (event) => performanceEvents.push(event) });

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
    await new Promise((resolve) => setImmediate(resolve));
    expect(performanceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'cashflow.month_close.read', phase: 'publication_before' }),
      expect.objectContaining({ operation: 'cashflow.month_close.read', phase: 'jvm_dashboard' }),
      expect.objectContaining({ operation: 'cashflow.month_close.read', phase: 'jvm_compliance' }),
      expect.objectContaining({ operation: 'cashflow.month_close.read', phase: 'dashboard_compose' }),
      expect.objectContaining({ operation: 'cashflow.month_close.read', phase: 'publication_after' }),
    ]));
    expect(performanceEvents.every((event) => event.requestId === 'req-1')).toBe(true);
  });

  it('publishes the server-owned cumulative close scope and pinned sheet source for 2026-08', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true,
        projectId: 'project-a',
        yearMonth: '2026-08',
        status: 'OPEN',
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-08')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.cumulativeCloseScope).toEqual({
          contractVersion: 'cashflow-cumulative-close-v2',
          fromMonth: '2023-01',
          throughMonth: '2026-08',
          lockRange: {
            fromMonth: '2023-01',
            fromWeekNo: 1,
            throughMonth: '2026-08',
            throughWeekNo: 5,
          },
          monthCount: 44,
          weekCount: 220,
          cellCount: 7040,
          source: {
            sourceRevision: source.sourceRevision,
            targetRevision: source.targetRevision,
            capturedAt: '2026-07-01T00:00:00.000Z',
            spreadsheetId: 'spreadsheet-a',
            spreadsheetTitle: '2026 사업비 관리 시트',
            selectedSheetName: 'cashflow(사용내역 연동)',
            spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit',
          },
        });
      });
  });

  it.each([
    ['invalid format', '2026-13'],
    ['before the cumulative baseline', '2022-12'],
    ['beyond the bounded cumulative range', '2043-01'],
  ])('rejects %s before reading the JVM month-close source', async (_label, yearMonth) => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService());

    await request(app)
      .get(`/api/v1/cashflow/project-a/month-close?yearMonth=${yearMonth}`)
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_month_close_request_invalid');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not publish a month dashboard while a sheet apply is in progress', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_publications/project-a', {
      projectId: 'project-a',
      status: 'APPLYING',
      stagedRunId: 'run-in-flight',
      sourceRevision: source.sourceRevision,
      targetRevisionAtFetch: source.targetRevision,
      applyStartedAt: '2026-07-24T08:00:00.000Z',
    });
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_apply_in_progress');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('combines explicit sheet refresh and JVM month-close audit records for the activity timeline', async () => {
    const activityQueries = [];
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
        where: () => {
          const query = { collectionId: path.split('/').at(-1), orderBy: null, limit: null };
          activityQueries.push(query);
          const chain = {
            orderBy: (field, direction) => {
              query.orderBy = [field, direction];
              return chain;
            },
            limit: (limit) => {
              query.limit = limit;
              return chain;
            },
            get: async () => ({ docs: (eventsByCollection[query.collectionId] || []).map((data) => ({ id: data.id, data: () => data })) }),
          };
          return chain;
        },
      }),
    };
    const { app } = createApp(vi.fn(), createIdempotencyService(), {}, { env: runtimeEnv, db });

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
    expect(activityQueries.find((query) => query.collectionId === 'weekly_api_audit_events')).toMatchObject({
      orderBy: null,
      limit: 200,
    });
  });

  it('reads one bounded activity source without waiting for the other timeline sources', async () => {
    const activityQueries = [];
    const db = {
      collection: (path) => ({
        where: () => {
          const query = { collectionId: path.split('/').at(-1), limit: null };
          activityQueries.push(query);
          const chain = {
            orderBy: () => chain,
            limit: (limit) => {
              query.limit = limit;
              return chain;
            },
            get: async () => ({ docs: [] }),
          };
          return chain;
        },
      }),
    };
    const { app } = createApp(vi.fn(), createIdempotencyService(), {}, { env: runtimeEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/activity?source=legacy')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a', source: 'legacy', events: [] });
      });

    expect(activityQueries).toEqual([{ collectionId: 'cashflow_events', limit: 200 }]);
  });

  it('flattens all 100 exact applied cell changes from one JVM audit into General Activity', async () => {
    const appliedCellChanges = Array.from({ length: 100 }, (_, index) => ({
      yearMonth: '2026-06',
      weekNo: (index % 5) + 1,
      mode: index % 2 === 0 ? 'projection' : 'actual',
      cashflowLine: `LINE_${index}`,
      before: index % 3 === 0 ? { cellState: 'EMPTY', amount: null } : index % 3 === 1 ? { cellState: 'ZERO', amount: 0 } : { cellState: 'VALUE', amount: index },
      after: index % 3 === 0 ? { cellState: 'ZERO', amount: 0 } : { cellState: 'VALUE', amount: index + 1000 },
      actorId: 'pm-1', actorName: '담당자', actorEmail: 'pm@example.com', changedAt: '2026-07-01T12:00:00.000Z',
      reason: '시트 정정', source: 'cashflow-sheet', operationType: 'BATCH_APPLY', operationId: 'operation-100', auditId: 'audit-100',
      sourceRevision: 'source-1', targetRevision: 'target-2', idempotencyKey: 'run-100',
    }));
    const audit = {
      id: 'audit-100', projectId: 'project-a', idempotencyKey: 'run-100', commandName: 'weeklyExpense.cashflowSheetLab.apply',
      actorId: 'pm-1', createdAt: '2026-07-01T12:00:00.000Z',
      metadataJson: JSON.stringify({
        yearMonth: '2026-06', projectionLineCount: 50, actualLineCount: 50, actorName: '담당자', actorEmail: 'pm@example.com',
        operationType: 'BATCH_APPLY', operationId: 'operation-100', reason: '시트 정정', appliedCellChanges,
      }),
    };
    const db = {
      collection: () => ({
        where: () => {
          const chain = {
            orderBy: () => chain,
            limit: () => chain,
            get: async () => ({ docs: [{ id: audit.id, data: () => audit }] }),
          };
          return chain;
        },
      }),
    };
    const { app } = createApp(vi.fn(), createIdempotencyService(), {}, { env: runtimeEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/activity?source=audit')
      .expect(200)
      .expect((response) => {
        const changes = response.body.events.filter((event) => event.type === 'projection_amount_change' || event.type === 'actual_amount_change');
        expect(changes).toHaveLength(100);
        expect(response.body.events.filter((event) => event.type === 'sheet_apply')).toHaveLength(1);
        expect(changes[0]).toMatchObject({
          id: 'sheet-apply-cell:audit-100:0', runId: 'run-100', operation: 'BATCH_APPLY', operationId: 'operation-100', auditId: 'audit-100',
          yearMonth: '2026-06', weekNo: 1, mode: 'projection', lineId: 'LINE_0', beforeState: 'EMPTY', afterState: 'ZERO',
          beforeHadValue: false, afterHadValue: true, afterAmount: 0, actorName: '담당자', reason: '시트 정정', sourceDetail: 'cashflow-sheet',
        });
        expect(changes[1]).toMatchObject({ beforeState: 'ZERO', beforeAmount: 0, afterState: 'VALUE', afterAmount: 1001 });
        expect(changes[99]).toMatchObject({ lineId: 'LINE_99' });
      });
  });

  it('rejects an unknown activity source without reading Firestore', async () => {
    const db = { collection: vi.fn() };
    const { app } = createApp(vi.fn(), createIdempotencyService(), {}, { env: runtimeEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/activity?source=unknown')
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_activity_source_invalid');
      });

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('rejects General Activity before Firestore when the actor role is not authorized', async () => {
    const db = { collection: vi.fn() };
    const { app } = createApp(vi.fn(), createIdempotencyService(), { actorRole: 'external' }, { env: runtimeEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/activity?source=audit')
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('forbidden'));

    expect(db.collection).not.toHaveBeenCalled();
  });

  it('composes the open-month dashboard from the pinned sheet, project, and JVM state without a private draft', async () => {
    const { db, sourceRevision, targetRevision } = fullMonthCloseSource();
    const projectionActualSummary = {
      projectId: 'project-a',
      fromMonth: '2023-01',
      comparisonAsOfWeek: { yearMonth: '2026-07', weekNo: 2 },
      settlementDifferenceAmount: 18_371_453,
      settlementMatches: false,
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ...monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        }),
        projectionActualSummary,
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
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
            projectionProgressPercent: 10,
            projectionSalesAndVatTotal: 100,
            contractDifference: 900,
            contractCoveragePercent: 10,
            actualProgressPercent: 100,
            confirmationProgressPercent: 0,
            settlementProgressPercent: 0,
            settlementDifferenceAmount: 18_371_453,
            settlementMatches: false,
            settlementCompletedWeekCount: 0,
            settlementTargetWeekCount: 5,
          },
          validation: { canClose: true, blockers: [] },
          projectionActualSummary,
        });
        expect(response.body.dashboard.cells).toHaveLength(160);
        expect(response.body.dashboard.depositScheduleRows).toHaveLength(5);
      });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    { projectId: 'other-project', fromMonth: '2023-01', comparisonAsOfWeek: { yearMonth: '2026-07', weekNo: 2 }, settlementDifferenceAmount: 18_371_453, settlementMatches: false },
  ])('fails closed when the JVM dashboard canonical projection-actual summary is unavailable or mismatched', async (projectionActualSummary) => {
    const { db } = fullMonthCloseSource();
    const source = monthDashboardSource({
      ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
      reopenCount: 0, projectWarningCount: 0, snapshot: {},
    });
    source.projectionActualSummary = projectionActualSummary;
    const { app } = createApp(vi.fn(async () => ({
      ok: true, status: 200, text: async () => JSON.stringify(source),
    })), createIdempotencyService(), {}, { env: runtimeEnv, db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(502)
      .expect((response) => expect(response.body.code).toBe('jvm_weekly_response_invalid'));
  });

  it.each([
    ['/api/v1/cashflow/project-a/month-close/approver', { approverUid: 'finance-1', yearMonth: '2026-08' }],
    ['/api/v1/cashflow/project-a/month-close/requests', { expectedApproverUid: 'finance-1', expectedProjectVersion: 0 }],
    ['/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review', { decision: 'APPROVE', expectedRevision: 0 }],
    ['/api/v1/cashflow/project-a/month-close', { yearMonth: '2026-08' }],
  ])('blocks %s before any BFF Firestore workflow write when BFF and JVM data projects differ', async (path, body) => {
    const db = { doc: vi.fn(), runTransaction: vi.fn(), collection: vi.fn() };
    const env = { ...runtimeEnv, JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'other-data-project' };
    const { app } = createApp(vi.fn(), createIdempotencyService(), { actorRole: 'viewer' }, { env, db });

    await request(app)
      .post(path)
      .set('idempotency-key', `mismatch-${path}`)
      .send(body)
      .expect(503)
      .expect((response) => expect(response.body.code).toBe('jvm_weekly_data_project_mismatch'));

    expect(db.doc).not.toHaveBeenCalled();
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('uses the real server time on both sides of the Thursday midnight deadline', async () => {
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
    let canonicalStatus = 'PENDING';
    const weeklyComplianceResponse = () => ({
      items: [{
        yearMonth: '2026-07', weekNo: 3, deadline: '2026-07-17T00:00:00+09:00', status: canonicalStatus,
        completedAt: null, completedBy: null, operationId: '', auditId: '', updateResult: '',
      }],
      nextCursor: '', onTimeCount: 0, missedCount: canonicalStatus === 'MISSED' ? 1 : 0,
    });
    const before = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv, db: source.db, weeklyComplianceResponse,
      now: () => new Date('2026-07-16T14:59:00.000Z'),
    });
    await request(before.app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary.current).toMatchObject({ status: 'PENDING' });
        expect(response.body.dashboard.deadlineSummary.weeklyStatuses).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 4, status: 'PENDING' }),
        ]));
      });

    canonicalStatus = 'MISSED';
    const after = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv, db: source.db, weeklyComplianceResponse,
      now: () => new Date('2026-07-16T15:01:00.000Z'),
    });
    await request(after.app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary.current).toMatchObject({ status: 'MISSED' });
        expect(response.body.dashboard.deadlineSummary.missedCount).toBeGreaterThan(0);
      });
  });

  it('keeps dashboard comparison, management checks, and weekly controls on the same real KST time', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-06-07T15:30:00.000Z'),
      weeklyComplianceResponse: {
        items: [{
          yearMonth: '2026-07', weekNo: 3, deadline: '2026-07-17T00:00:00+09:00', status: 'PENDING',
          completedAt: null, completedBy: null, operationId: '', auditId: '', updateResult: '',
        }],
        nextCursor: '', onTimeCount: 0, missedCount: 0,
      },
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.summary).toMatchObject({
          comparisonAsOfDate: '2026-06-08',
          comparisonAsOfWeek: { yearMonth: '2026-06', weekNo: 2 },
        });
        expect(response.body.dashboard.comparison.weeks.map((week) => week.weekNo)).toEqual([1, 2]);
        expect(response.body.dashboard.managementChecks.find((check) => check.id === 'labor-transfer')).toMatchObject({ status: 'OK' });
        expect(response.body.dashboard.deadlineSummary.current).toBeNull();
      });
  });

  it('does not derive weekly compliance from a BFF reset-control document', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_stage_runs/tracking-start', {
      projectId: 'project-a', status: 'APPLIED', appliedAt: '2026-07-06T10:00:00+09:00',
    });
    source.documents.set('orgs/tenant-a/cashflow_weekly_update_reset_controls/project-a', {
      projectId: 'project-a', trackingStartedAt: '2026-07-17T00:01:00+09:00',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.deadlineSummary).toMatchObject({ trackingStartedAt: null, missedCount: 0, completedCount: 0 });
        expect(response.body.dashboard.deadlineSummary.weeklyStatuses).toEqual([]);
      });
  });

  it('persists the explicit weekly settlement completion with its actor and exposes it in the dashboard', async () => {
    const source = fullMonthCloseSource();
    source.documents.set('orgs/tenant-a/cashflow_sheet_stage_runs/tracking-start', {
      projectId: 'project-a', status: 'APPLIED', appliedAt: '2026-07-06T10:00:00+09:00',
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
    const weeklyComplianceResponse = () => {
      const completion = source.documents.get('orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3');
      return {
        items: completion ? [{
          yearMonth: '2026-07', weekNo: 3, deadline: '2026-07-17T00:00:00+09:00', status: 'ON_TIME',
          completedAt: completion.completedAt, completedBy: completion.completedByEmail,
          operationId: 'op-week-3', auditId: 'audit-week-3', updateResult: 'NO_CHANGES',
        }] : [],
        nextCursor: '', onTimeCount: completion ? 1 : 0, missedCount: 0,
      };
    };
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, {
      env: runtimeEnv, db: source.db, weeklyComplianceResponse,
      now: () => new Date('2026-07-16T09:00:00.000Z'),
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ updateResult: 'NO_CHANGES' })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        projectId: 'project-a', yearMonth: '2026-07', weekNo: 3, alreadyCompleted: false,
      }));

    const saved = source.documents.get('orgs/tenant-a/cashflow_weekly_update_completions/project-a-2026-07-w3');
    expect(saved).toMatchObject({ projectId: 'project-a', yearMonth: '2026-07', weekNo: 3 });
    source.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-06', {
      projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED',
    });
    source.documents.set('orgs/tenant-a/monthly_closes/project-a-2026-05', {
      projectId: 'project-a',
      yearMonth: '2026-05',
      status: 'CLOSED',
      snapshot: {
        sheetFacts: {
          weeklyCalculationChecks: [{
            mode: 'projection',
            yearMonth: '2026-05',
            weekNo: 1,
            reported: { depositTotal: 111, withdrawalTotal: 222, balance: 333 },
          }],
        },
      },
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
          yearMonth: '2026-07', weekNo: 3, status: 'ON_TIME',
        });
        expect(response.body.dashboard.deadlineSummary.completedWeeks).toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 3, completedBy: 'pm@example.com' }),
        ]));
        expect(response.body.dashboard.deadlineSummary.weeklyStatuses).toEqual(expect.arrayContaining([
          expect.objectContaining({ yearMonth: '2026-07', weekNo: 3, status: 'ON_TIME', updateResult: 'NO_CHANGES' }),
        ]));
        expect(response.body.dashboard.monthCloseStatuses).toEqual(expect.arrayContaining([
          // 결산 기한은 대상월 다음 달 10일이고, 이미 닫힌 달은 기한이 지나도 초과가 아니다.
          expect.objectContaining({ yearMonth: '2026-06', closeDeadline: '2026-07-10', closeOverdue: false }),
          expect.objectContaining({ yearMonth: '2026-05', closeDeadline: '2026-06-10', closeOverdue: false }),
          expect.objectContaining({ yearMonth: '2026-06', status: 'CLOSED' }),
          expect.objectContaining({
            yearMonth: '2026-05',
            status: 'CLOSED',
            sheetCalculationChecks: [expect.objectContaining({
              mode: 'projection',
              yearMonth: '2026-05',
              weekNo: 1,
              reported: { depositTotal: 111, withdrawalTotal: 222, balance: 333 },
            })],
          }),
        ]));
      });
  });

  it('allows aligned Live weekly completion using the real server clock', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          projectId: 'project-a',
          yearMonth: body.yearMonth,
          weekNo: body.weekNo,
          completedAt: body.completedAt,
          completedBy: 'pm@example.com',
          alreadyCompleted: false,
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-08-01T05:00:00.000Z'),
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .set('idempotency-key', 'live-weekly-complete-1')
      .send({ updateResult: 'NO_CHANGES' })
      .expect(200);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers['x-data-project-id']).toBe('live-data-project');
    expect(JSON.parse(init.body)).toMatchObject({
      idempotencyKey: 'cashflow-weekly:live-weekly-complete-1',
      yearMonth: '2026-08',
      weekNo: 1,
      completedAt: '2026-08-01T05:00:00.000Z',
      updateResult: 'NO_CHANGES',
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
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/weekly-update-complete?yearMonth=2026-06&weekNo=2')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        yearMonth: '2026-06', weekNo: 2, status: 'LOCKED', revision: 1,
      }));

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06', weekNo: 2, updateResult: 'CHANGED' })
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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-07-16T09:00:00.000Z'),
      weeklyComplianceResponse: {
        items: [{
          yearMonth: '2026-07', weekNo: 3, deadline: '2026-07-17T00:00:00+09:00', status: 'PENDING',
          completedAt: null, completedBy: null, operationId: '', auditId: '', updateResult: '',
        }],
        nextCursor: '', onTimeCount: 0, missedCount: 0,
      },
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.dashboard.deadlineSummary.current).toMatchObject({
        yearMonth: '2026-07', weekNo: 3, status: 'PENDING', completedAt: null,
      }));
  });

  it('counts ON_TIME and COMPLETED_LATE as completed without changing JVM compliance counts', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      weeklyComplianceResponse: {
        items: [
          { yearMonth: '2026-06', weekNo: 1, status: 'ON_TIME', completedAt: '2026-06-05T00:00:00+09:00' },
          { yearMonth: '2026-06', weekNo: 2, status: 'COMPLETED_LATE', completedAt: '2026-06-13T00:00:00+09:00' },
          { yearMonth: '2026-06', weekNo: 3, status: 'MISSED', completedAt: null },
          { yearMonth: '2026-06', weekNo: 4, status: 'PENDING', completedAt: null },
        ],
        nextCursor: '',
        onTimeCount: 1,
        missedCount: 2,
      },
    });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.dashboard.deadlineSummary).toMatchObject({
        onTimeCount: 1,
        missedCount: 2,
        completedCount: 2,
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
      env: runtimeEnv,
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
      .send({ yearMonth: '2026-06', weekNo: 2, updateResult: 'CHANGED' })
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
      env: runtimeEnv,
      db: fullMonthCloseSource().db,
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .send({ yearMonth: '2026-06', weekNo: 2, updateResult: 'NO_CHANGES' })
      .expect(503)
      .expect((response) => expect(response.body).toMatchObject({
        code: 'cashflow_weekly_completion_backend_unavailable',
        message: expect.stringContaining('처리하지 못했습니다'),
      }));
  });

  it('passes updateResult and JVM 16-week missing-cell evidence without recalculating it', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.updateResult).toBe('NO_CHANGES');
      return {
        ok: false,
        status: 409,
        text: async () => JSON.stringify({
          code: 'cashflow_projection_window_incomplete',
          message: 'Projection window is incomplete.',
          details: {
            requiredWeekCount: 16,
            requiredCellCount: 256,
            missingCells: [{ yearMonth: '2026-05', weekNo: 1, lineId: 'SALES_IN' }],
          },
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'viewer' }, {
      env: runtimeEnv, db: fullMonthCloseSource().db,
    });
    await request(app)
      .post('/api/v1/cashflow/project-a/weekly-update-complete')
      .set('idempotency-key', 'weekly-no-changes')
      .send({ yearMonth: '2026-06', weekNo: 2, updateResult: 'NO_CHANGES' })
      .expect(409)
      .expect((response) => expect(response.body).toMatchObject({
        code: 'cashflow_projection_window_incomplete',
        details: {
          requiredWeekCount: 16, requiredCellCount: 256,
          missingCells: [{ yearMonth: '2026-05', weekNo: 1, lineId: 'SALES_IN' }],
        },
      }));
  });

  it('adapts the canonical JVM weekly compliance cursor page and validates its query', async () => {
    const canonical = {
      items: [{
        yearMonth: '2026-06', weekNo: 2, deadline: '2026-06-11T23:59:59+09:00', status: 'ON_TIME',
        completedAt: '2026-06-11T08:00:00Z', completedBy: 'pm-1', operationId: 'op-1', auditId: 'audit-1',
        updateResult: 'CHANGED',
      }],
      nextCursor: 'opaque-next', onTimeCount: 7, missedCount: 2,
    };
    const fetchImpl = vi.fn(async (url) => {
      expect(url.endsWith('/weekly-update-compliance?limit=25&cursor=opaque%2Fcursor')).toBe(true);
      return { ok: true, status: 200, text: async () => JSON.stringify(canonical) };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), { actorRole: 'auditor' }, {
      env: runtimeEnv, forwardWeeklyComplianceFetch: true,
    });
    await request(app)
      .get('/api/v1/cashflow/project-a/weekly-update-compliance?limit=25&cursor=opaque%2Fcursor')
      .expect(200)
      .expect((response) => expect(response.body).toEqual(canonical));
    await request(app)
      .get('/api/v1/cashflow/project-a/weekly-update-compliance?limit=0')
      .expect(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('proxies canonical applied cell changes without collapsing EMPTY and ZERO', async () => {
    const canonical = {
      items: [{
        eventId: 'event-1', cellId: 'event-1:0', projectId: 'project-a', yearMonth: '2026-08', weekNo: 1,
        mode: 'actual', lineId: 'SALES_IN', beforeHadValue: false, beforeState: 'EMPTY', beforeAmount: null,
        afterHadValue: true, afterState: 'ZERO', afterAmount: 0, actorUid: 'pm-1', actorName: 'PM', actorEmail: 'pm@example.com',
        reason: 'confirmed', source: 'monthly-shard', operationType: 'BATCH_APPLY', operationId: 'op-1', auditId: 'audit-1',
        sourceRevision: 'r1', targetRevision: 'r2', createdAt: '2026-07-30T02:00:01Z',
      }],
      nextCursor: 'opaque-next',
    };
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url.endsWith('/applied-cell-changes?limit=25&cursor=opaque%2Fcursor')).toBe(true);
      expect(new Headers(init.headers).get('x-tenant-id')).toBe('tenant-a');
      expect(new Headers(init.headers).get('x-actor-id')).toBe('pm-1');
      return new Response(JSON.stringify(canonical), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const { app } = createApp(fetchImpl);
    await request(app)
      .get('/api/v1/cashflow/project-a/applied-cell-changes?limit=25&cursor=opaque%2Fcursor')
      .expect(200)
      .expect((response) => expect(response.body).toEqual(canonical));
    await request(app).get('/api/v1/cashflow/project-a/applied-cell-changes?limit=0').expect(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries applied cell history transport failures and preserves JVM errors', async () => {
    const retryFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: '' }), { status: 200 }));
    const retryApp = createApp(retryFetch).app;
    await request(retryApp).get('/api/v1/cashflow/project-a/applied-cell-changes').expect(200);
    expect(retryFetch).toHaveBeenCalledTimes(2);

    const deniedApp = createApp(vi.fn(async () => new Response(JSON.stringify({ code: 'project_forbidden', message: 'forbidden' }), { status: 403 }))).app;
    await request(deniedApp)
      .get('/api/v1/cashflow/project-a/applied-cell-changes')
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('project_forbidden'));

    const conflictApp = createApp(vi.fn(async () => new Response(JSON.stringify({ code: 'weekly_expense_conflict', message: 'corrupt evidence' }), { status: 409 }))).app;
    await request(conflictApp)
      .get('/api/v1/cashflow/project-a/applied-cell-changes')
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('weekly_expense_conflict'));
  });

  it('enforces applied cell history role and tenant context before JVM access', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: '' }), { status: 200 }));
    await request(createApp(fetchImpl, createIdempotencyService(), { actorRole: 'external' }).app)
      .get('/api/v1/cashflow/project-a/applied-cell-changes')
      .expect(403);
    await request(createApp(fetchImpl, createIdempotencyService(), { tenantId: '' }).app)
      .get('/api/v1/cashflow/project-a/applied-cell-changes')
      .expect(400);
    expect(fetchImpl).not.toHaveBeenCalled();
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
      ['profit-vat-after-deposit', 'OK'],
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
    )).map((cell) => (
      cell.mode === 'projection' && cell.weekNo === 5 && ['MYSC_PROFIT_OUT', 'SALES_VAT_OUT'].includes(cell.cashflowLine)
        ? { ...cell, amount: 0 }
        : cell
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
    expect(checks[1].detail).toContain('2026-06 5주차에 매출입금이 있으나 [MYSC 수익·매출부가세] 계획이 Projection에 없습니다.');
    expect(checks[0].detail).toContain('실제 0원 · 실제 미이관');
    expect(checks[0].findings).toContain('2026-06 3주차 · 예정 10원 · 실제 0원 · 실제 미이관');
    expect(checks[2].findings).toHaveLength(5);
    expect(checks[2].findings[0]).toContain('2026-06 1주차');
    expect(checks[2].findings.at(-1)).toContain('2026-06 5주차');
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
      detail: '2026-06 3주차 인건비 미입력',
      findings: ['2026-06 3주차 인건비 미입력'],
    });
  });

  it('uses the same simple finding for an explicit-zero third-week Projection labor plan', () => {
    const { documents } = fullMonthCloseSource();
    const draft = [...documents.values()].find((value) => value?.resourceType === 'cashflow');
    const cells = draft.payload.monthClose.cells.map((cell) => (
      cell.mode === 'projection' && cell.weekNo === 3 && cell.cashflowLine === 'MYSC_LABOR_OUT'
        ? { ...cell, cellState: 'ZERO', amount: 0 }
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
      status: 'REVIEW_REQUIRED',
      title: 'MYSC 인건비 이관',
      detail: '2026-06 3주차 인건비 미입력',
      findings: ['2026-06 3주차 인건비 미입력'],
    });
  });

  it('names the exact missing Projection plans after each sales deposit', () => {
    const checks = buildCashflowManagementChecks({
      cashflow: {
        readModel: {
          months: [{
            yearMonth: '2026-07',
            projection: { weeks: [
              { weekNo: 1, amounts: { SALES_IN: 1_000 } },
              { weekNo: 2, amounts: {} },
              { weekNo: 3, amounts: { SALES_IN: 2_000, MYSC_PROFIT_OUT: 100 } },
              { weekNo: 4, amounts: {} },
            ] },
            actual: { weeks: [] },
          }],
        },
      },
      cells: [],
      yearMonth: '2026-07',
      depositScheduleRows: [],
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-07', weekNo: 4 } },
    });

    expect(checks.find((check) => check.id === 'profit-vat-after-deposit')?.findings).toEqual([
      '2026-07 1주차에 매출입금이 있으나 [MYSC 수익·매출부가세] 계획이 Projection에 없습니다.',
      '2026-07 3주차에 매출입금이 있으나 [매출부가세] 계획이 Projection에 없습니다.',
    ]);
  });

  it('does not warn when profit and sales VAT are planned in either the deposit week or the next week', () => {
    const checks = buildCashflowManagementChecks({
      cashflow: {
        readModel: {
          months: [{
            yearMonth: '2026-07',
            projection: { weeks: [
              { weekNo: 1, amounts: { SALES_IN: 1_000, MYSC_PROFIT_OUT: 100, SALES_VAT_OUT: 10 } },
              { weekNo: 2, amounts: { SALES_IN: 2_000 } },
              { weekNo: 3, amounts: { MYSC_PROFIT_OUT: 200, SALES_VAT_OUT: 20 } },
            ] },
            actual: { weeks: [] },
          }],
        },
      },
      cells: [],
      yearMonth: '2026-07',
      depositScheduleRows: [],
      comparisonBoundary: { asOfWeek: { yearMonth: '2026-07', weekNo: 3 } },
    });

    const transferCheck = checks.find((check) => check.id === 'profit-vat-after-deposit');
    expect(transferCheck).toMatchObject({
      status: 'OK',
      title: '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)',
    });
    expect(transferCheck).not.toHaveProperty('findings');
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
      amount: cell.mode === 'projection' && [1, 2].includes(cell.weekNo) && ['MYSC_PROFIT_OUT', 'SALES_VAT_OUT'].includes(cell.lineId) ? 0 : cell.amount,
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

    expect(checks.find((check) => check.id === 'labor-transfer')?.detail).toContain('2026-07 3주차 인건비 미입력');
    expect(checks.find((check) => check.id === 'profit-vat-after-deposit')?.detail).toContain('2026-07 1주차에 매출입금이 있으나 [MYSC 수익·매출부가세] 계획이 Projection에 없습니다.');
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

    const negative = checks.find((check) => check.id === 'negative-projection-balance');
    expect(negative).toMatchObject({
      id: 'negative-projection-balance',
      status: 'WARNING',
      title: 'Projection 잔액 마이너스',
    });
    expect(negative.findings[0]).toContain('2024-09 2주차');
    expect(negative.findings).toHaveLength(9);
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
      env: runtimeEnv,
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
      env: runtimeEnv,
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
      env: runtimeEnv,
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
      env: runtimeEnv,
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
      env: runtimeEnv,
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
        env: runtimeEnv,
        db,
        now: () => new Date('2026-07-10T00:00:00.000Z'),
      });

      await request(app)
        .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
        .expect(200)
        .expect((response) => {
      expect(response.body.dashboard.summary.projectionProgressPercent).toBe(100);
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
      projection: { totalIn: 650, lineAmounts: { SALES_IN: 500, SALES_VAT_IN: 150 } },
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
      env: runtimeEnv,
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
          projectionSalesAndVatTotal: 1000,
          contractDifference: 0,
          contractCoveragePercent: 100,
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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: current.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard).toMatchObject({
          source: { kind: 'MONTH_CLOSE_SNAPSHOT', sourceRevision: `sha256:${'f'.repeat(64)}` },
          cumulativeCloseScope: {
            fromMonth: '2023-01',
            throughMonth: '2026-06',
            monthCount: 42,
            weekCount: 210,
            cellCount: 6720,
            source: {
              sourceRevision: `sha256:${'f'.repeat(64)}`,
              targetRevision: `sha256:${'a'.repeat(64)}`,
              capturedAt: '2026-07-09T00:00:00.000Z',
              spreadsheetId: null,
              spreadsheetUrl: null,
            },
          },
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

  it('shows the current JVM ledger after an approved CLOSED-month amendment while preserving the original snapshot', async () => {
    const frozenWeeklyTotals = Array.from({ length: 5 }, (_, index) => ({
      weekNo: index + 1,
      projection: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, lineId === 'SALES_IN' && index === 0 ? 100 : 0])),
      actual: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, 0])),
    }));
    const currentWeeklyTotals = frozenWeeklyTotals.map((week, index) => ({
      ...week,
      projection: index === 0 ? { ...week.projection, SALES_IN: 101 } : week.projection,
    }));
    const currentReadModel = {
      months: [{
        yearMonth: '2026-06',
        projection: {
          rowTotals: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, lineId === 'SALES_IN' ? 101 : 0])),
          weeks: currentWeeklyTotals.map((week) => ({
            weekNo: week.weekNo,
            amounts: week.projection,
            totalIn: week.projection.SALES_IN,
            totalOut: 0,
            weekIn: week.projection.SALES_IN,
            weekOut: 0,
            net: 101,
          })),
          monthTotals: { totalIn: 101, totalOut: 0, net: 101 },
        },
        actual: {
          rowTotals: Object.fromEntries(cashflowLineIds.map((lineId) => [lineId, 0])),
          weeks: currentWeeklyTotals.map((week) => ({
            weekNo: week.weekNo,
            amounts: week.actual,
            totalIn: 0,
            totalOut: 0,
            weekIn: 0,
            weekOut: 0,
            net: 0,
          })),
          monthTotals: { totalIn: 0, totalOut: 0, net: 0 },
        },
      }],
    };
    const close = {
      ok: true,
      projectId: 'project-a',
      yearMonth: '2026-06',
      status: 'CLOSED',
      revision: 2,
      reopenCount: 0,
      projectWarningCount: 1,
      amendmentCount: 1,
      lastAmendmentAt: '2026-07-09T00:00:00.000Z',
      lastAmendmentByName: '보람',
      lastAmendmentReason: '시트 정정',
      lastAmendmentEvidence: {
        closeRevision: 2,
        sourceRevision: `sha256:${'1'.repeat(64)}`,
        targetRevision: `sha256:${'2'.repeat(64)}`,
        resultingTargetRevision: `sha256:${'3'.repeat(64)}`,
        calculationChecks: Array.from({ length: 10 }, (_, index) => ({
          mode: index < 5 ? 'projection' : 'actual',
          yearMonth: '2026-06',
          weekNo: (index % 5) + 1,
          reported: { depositTotal: index === 0 ? 999 : 0, withdrawalTotal: 0, balance: index === 0 ? 999 : 0 },
        })),
      },
      snapshot: {
        project: { contractAmount: 101 },
        sourceFingerprint: `sha256:${'f'.repeat(64)}`,
        weeklyTotals: frozenWeeklyTotals,
        ledgerWeeks: frozenWeeklyTotals.map((week) => ({
          yearMonth: '2026-06',
          weekNo: week.weekNo,
          projection: week.projection,
          actual: week.actual,
        })),
        depositScheduleRows: [],
        confirmations: [],
      },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource(
        close,
        { projectId: 'project-a', projection: [], actual: [], readModel: currentReadModel },
        {
          selectedYear: 2026,
          projection: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
          actual: { amount: 0, lineAmounts: {}, sources: [], includedYears: [], excludedWeeklyYears: [] },
        },
        { status: 'LIVE_AMENDED', missingEvidence: [] },
      )),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: createMonthCloseDb() });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.source.kind).toBe('MONTH_CLOSE_AMENDED_CURRENT');
        expect(response.body.dashboard.snapshotCompatibility.status).toBe('LIVE_AMENDED');
        expect(response.body.dashboard.totals.projection.totalIn).toBe(101);
        expect(response.body.dashboard.canonical.months[0].projection.weeks[0].amounts.SALES_IN).toBe(101);
        expect(response.body.dashboard.cells).toHaveLength(160);
        expect(response.body.dashboard.cells.find((cell) => (
          cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === 'SALES_IN'
        ))).toMatchObject({ cellState: 'VALUE', amount: 101 });
        expect(response.body.dashboard.cells.find((cell) => (
          cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === 'BANK_INTEREST_IN'
        ))).toMatchObject({ cellState: 'ZERO', amount: 0 });
        expect(response.body.dashboard.sheetCalculationChecks[0].reported.depositTotal).toBe(999);
        expect(response.body.dashboard.source).toMatchObject({
          sourceRevision: `sha256:${'1'.repeat(64)}`,
          targetRevision: `sha256:${'3'.repeat(64)}`,
        });
      });
    currentReadModel.months = [];
    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.cells).toHaveLength(160);
        expect(response.body.dashboard.cells.every((cell) => cell.cellState === 'EMPTY')).toBe(true);
        expect(response.body.dashboard.totals.projection.totalIn).toBe(0);
      });
    expect(close.snapshot.weeklyTotals[0].projection.SALES_IN).toBe(100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: createMonthCloseDb() });

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

  it('reports a stale sheet blocker and refuses final close', async () => {
    for (const source of [fullMonthCloseSource({ mirrorStatus: 'STALE' })]) {
      const fetchImpl = vi.fn(async (url) => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source') ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        }) : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED' }),
      }));
      const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

      const read = await request(app)
        .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
        .expect(200);
      expect(read.body.dashboard.validation.canClose).toBe(false);
      expect(read.body.dashboard.validation.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
        'SHEET_SOURCE_STALE',
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

  it('asks users to apply a newly loaded revision to the MYSCube sheet', async () => {
    const source = fullMonthCloseSource();
    source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a').appliedSourceRevision = `sha256:${'a'.repeat(64)}`;
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db });

    const response = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);

    expect(response.body.dashboard.validation.blockers).toContainEqual({
      code: 'SHEET_SOURCE_NOT_APPLIED',
      message: '불러온 값을 MYSCube 시트에 반영해 주세요.',
    });
    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-unapplied-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: response.body.dashboard.openingBalances,
        closeInput: {
          ...source.closeInput, managementChecks: response.body.dashboard.managementChecks, managementConfirmations: [],
        },
      })
      .expect(202);
    expect(created.body.reviewWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SHEET_SOURCE_NOT_APPLIED' }),
    ]));

    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-unapplied-approval')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((result) => expect(result.body.request.status).toBe('APPROVED'));
  });

  it('creates and approves a warning-backed request when the mirror document is missing but closeInput has 160 cells', async () => {
    const source = fullMonthCloseSource();
    source.documents.delete('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-missing-mirror-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: {
          ...source.closeInput, managementChecks: read.body.dashboard.managementChecks, managementConfirmations: [],
        },
      })
      .expect(202);

    expect(created.body.reviewWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SHEET_SOURCE_REQUIRED' }),
    ]));
    expect(created.body.monthSnapshot.source).toMatchObject({
      capturedAt: null,
      spreadsheetId: null,
      spreadsheetTitle: null,
      selectedSheetName: null,
      spreadsheetUrl: null,
    });
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-missing-mirror-approval')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'APPROVED', monthSnapshot: created.body.monthSnapshot,
      }));
  });

  it('warns when the pinned sheet total does not equal its item values', async () => {
    const source = fullMonthCloseSource({ calculationMismatch: true });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.validation.canClose).toBe(true);
        expect(response.body.dashboard.validation.warnings).toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'SHEET_CALCULATION_MISMATCH' }),
        ]));
      });
  });

  it('stores sheet reconciliation warnings in the designated-approver request', async () => {
    const source = fullMonthCloseSource({
      controlMatches: false, calculationMismatch: true, explicitZero: true, explicitEmpty: true,
    });
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    expect(read.body.dashboard.validation.canClose).toBe(true);
    expect(read.body.dashboard.validation.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'SHEET_CONTROL_TOTAL_MISMATCH',
      'SHEET_CALCULATION_MISMATCH',
    ]));

    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-warning-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks, managementConfirmations: [] },
      })
      .expect(202);

    expect(created.body.reviewWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'SHEET_CONTROL_TOTAL_MISMATCH',
      'SHEET_CALCULATION_MISMATCH',
    ]));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06').reviewWarnings)
      .toEqual(created.body.reviewWarnings);
    expect(created.body.monthSnapshot).toMatchObject({
      schemaVersion: 1,
      projectId: 'project-a',
      yearMonth: '2026-06',
      source: {
        sourceRevision: source.closeInput.sourceRevision,
        targetRevision: source.closeInput.targetRevision,
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: '2026 사업비 관리 시트',
        selectedSheetName: 'cashflow(사용내역 연동)',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit',
      },
      projection: { weeks: expect.any(Array), rowTotals: expect.any(Object) },
      actual: { weeks: expect.any(Array), rowTotals: expect.any(Object) },
      difference: { totalIn: expect.any(Number), totalOut: expect.any(Number), balance: expect.any(Number) },
    });
    for (const mode of ['projection', 'actual']) {
      expect(created.body.monthSnapshot[mode].weeks).toHaveLength(5);
      expect(created.body.monthSnapshot[mode].weeks.map((week) => week.cells.length)).toEqual([16, 16, 16, 16, 16]);
    }
    const emptyCell = created.body.monthSnapshot.projection.weeks[0].cells
      .find((cell) => cell.cellState === 'EMPTY');
    const zeroCell = created.body.monthSnapshot.projection.weeks[0].cells
      .find((cell) => cell.cellState === 'ZERO');
    expect(emptyCell).toMatchObject({ amount: null });
    expect(zeroCell).toMatchObject({ amount: 0 });
    expect(Buffer.byteLength(JSON.stringify(
      source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06'),
    ), 'utf8')).toBeLessThan(1_000_000);

    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-warning-approval')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'APPROVED',
        reviewWarnings: created.body.reviewWarnings,
        monthSnapshot: created.body.monthSnapshot,
      }));
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(1);
    const closeBody = JSON.parse(fetchImpl.mock.calls.find(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')[1].body);
    expect(Object.keys(closeBody).sort()).toEqual([
      'cells', 'confirmations', 'deadlineSummary', 'depositScheduleRows', 'expectedDraftRevision',
      'expectedRevision', 'humanReviewed', 'idempotencyKey', 'managementChecks',
      'managementConfirmations', 'openingBalances', 'sourceRevision', 'targetRevision', 'yearMonth',
    ].sort());
    expect(closeBody.managementConfirmations).toEqual([]);
    expect(closeBody.deadlineSummary).not.toHaveProperty('completedWeeks');
    expect(closeBody.deadlineSummary).not.toHaveProperty('weeklyStatuses');
  });

  it('blocks incomplete cell confirmations before creating an approval request', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-incomplete-confirmations')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: {
          ...source.closeInput,
          confirmations: source.closeInput.confirmations.slice(1),
          managementChecks: read.body.dashboard.managementChecks,
        },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_confirmations_incomplete'));
  });

  it('persists malformed sheet values as approval warnings', async () => {
    const source = fullMonthCloseSource();
    source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a').sheetFacts.issues = [{
      code: 'INVALID_AMOUNT', sourceCell: 'A17',
    }];
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    expect(read.body.dashboard.validation.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SHEET_VALUE_INVALID' }),
    ]));
    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-invalid-sheet-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks, managementConfirmations: [] },
      })
      .expect(202);
    expect(created.body.reviewWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SHEET_VALUE_INVALID' }),
    ]));

    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-invalid-sheet-approval')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200);
  });

  it('keeps an explicit sheet zero in the complete month-close evidence', async () => {
    const source = fullMonthCloseSource({ explicitZero: true });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.cells).toHaveLength(160);
        expect(response.body.dashboard.cells.find((cell) => (
          cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === 'SALES_IN'
        ))).toMatchObject({ cellState: 'ZERO', amount: 0 });
        expect(response.body.dashboard.validation.blockers).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'SHEET_MONTH_INCOMPLETE' }),
        ]));
      });
  });

  it('keeps an explicit zero when reading a closed month snapshot', async () => {
    const source = fullMonthCloseSource({ explicitZero: true });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1,
        reopenCount: 0, projectWarningCount: 0,
        snapshot: { cells: source.closeInput.cells, weeklyTotals: [] },
      }, undefined, undefined, { status: 'LIVE_CURRENT', missingEvidence: [] })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

    await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200)
      .expect((response) => {
        expect(response.body.dashboard.cells.find((cell) => (
          cell.mode === 'projection' && cell.weekNo === 1 && cell.cashflowLine === 'SALES_IN'
        ))).toMatchObject({ cellState: 'ZERO', amount: 0 });
      });
  });

  it('requires explicit reviewed close input before forwarding a month close', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
    }, { env: runtimeEnv, db: createMonthCloseDb() });

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
      env: runtimeEnv,
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
        expectedApproverUid: 'finance-1',
        expectedProjectVersion: 0,
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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });

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
      env: runtimeEnv,
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
      env: runtimeEnv,
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
        closeInput: { yearMonth: '2026-06', humanReviewed: true },
      })
      .expect(504)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_month_close_route_timeout');
      });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a month close that has not been explicitly reviewed by a person', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv, db: source.db });
    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-human-review-required')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, humanReviewed: false, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_human_review_required'));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(['viewer', 'pm', 'finance', 'admin'])('blocks a reviewed %s direct month close after authoritative preflight', async (actorRole) => {
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
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });

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
        expectedRevision: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput,
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approval_required'));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);
  });

  it('replays the same idempotent month-close request without closing the month', async () => {
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 4 }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });

    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    const payload = {
      yearMonth: '2026-06',
      approverUid: 'finance-1',
      expectedRevision: 0,
      expectedApproverUid: 'finance-1',
      expectedProjectVersion: 0,
      expectedOpeningBalances: read.body.dashboard.openingBalances,
      closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app)
        .post('/api/v1/cashflow/project-a/month-close/requests')
        .set('idempotency-key', 'month-close-retry-1')
        .send(payload)
        .expect(202)
        .expect((response) => expect(response.body).toMatchObject({ status: 'PENDING', revision: 0 }));
    }

    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'PENDING', createIdempotencyKey: 'month-close-retry-1',
    });
  });

  it('creates a designated-approver month-close request without closing the month', async () => {
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
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-request-1')
      .send({
        approverUid: 'attacker-selected-approver',
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedApproverUid: 'finance-1',
        expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);

    expect(created.body).toMatchObject({
      requestId: 'project-a-2026-06', projectId: 'project-a', yearMonth: '2026-06',
      status: 'PENDING', revision: 0, approverUid: 'finance-1', requestedByUid: 'pm-1',
    });
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'PENDING', approverUid: 'finance-1', createIdempotencyKey: 'month-close-request-1',
    });
  });

  it.each([
    ['missing calculation evidence', (source) => {
      delete source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a').sheetFacts.weeklyCalculationChecks;
    }, 'SHEET_CALCULATION_CHECK_MISSING'],
    ['invalid control evidence', (source) => {
      source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a').sheetFacts.controlTotals.projection[0].matches = null;
    }, 'SHEET_CONTROL_TOTAL_INVALID'],
  ])('persists %s as a review warning before approval', async (_label, mutate, expectedCode) => {
    const source = fullMonthCloseSource();
    mutate(source);
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', `invalid-close-request-${expectedCode}`)
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks, managementConfirmations: [] },
      })
      .expect(202);

    expect(created.body).toMatchObject({ status: 'PENDING' });
    expect(created.body.reviewWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: expectedCode }),
    ]));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'PENDING',
      monthSnapshot: { schemaVersion: 1, projectId: 'project-a', yearMonth: '2026-06' },
    });

    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', `invalid-close-approval-${expectedCode}`)
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request.status).toBe('APPROVED'));
  });

  it.each([
    ['just below the request document cap', 800_000, 202],
    ['above the request document cap', 880_000, 413],
  ])('%s', async (_label, detailBytes, expectedStatus) => {
    const source = fullMonthCloseSource();
    const check = source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a')
      .sheetFacts.weeklyCalculationChecks[0];
    check.matches.depositTotal = null;
    check.sourceCells = { detail: 'x'.repeat(detailBytes) };
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
          : {}),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    const response = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', `month-close-request-size-${detailBytes}`)
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(expectedStatus);

    const stored = source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06');
    if (expectedStatus === 202) {
      expect(Buffer.byteLength(JSON.stringify(stored), 'utf8')).toBeLessThanOrEqual(900_000);
    } else {
      expect(response.body.code).toBe('cashflow_month_close_request_too_large');
      expect(stored).toBeUndefined();
    }
  });

  it('still rejects incomplete month cells before creating an approval request', async () => {
    const source = fullMonthCloseSource();
    source.closeInput.cells.pop();
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : {}),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'invalid-close-request-cells-incomplete')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_cells_incomplete'));

    expect(source.documents.has('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toBe(false);
  });

  it('persists an active designated approver and blocks changes once approval is pending', async () => {
    const source = fullMonthCloseSource();
    source.documents.get('orgs/tenant-a/projects/project-a').version = 2;
    const { app } = createApp(vi.fn(), createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-29T00:00:00.000Z') });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .set('idempotency-key', 'set-approver-finance-2')
      .send({ approverUid: 'finance-2', yearMonth: '2026-07', expectedVersion: 2 })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        projectId: 'project-a', executiveApproverId: 'finance-2', executiveApproverName: '', version: 3,
      }));

    expect(source.documents.get('orgs/tenant-a/projects/project-a')).toMatchObject({
      executiveApproverId: 'finance-2', version: 3, updatedBy: 'pm-1',
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .set('idempotency-key', 'set-approver-finance-2')
      .send({ approverUid: 'finance-2', yearMonth: '2026-07', expectedVersion: 2 })
      .expect(200)
      .expect((response) => expect(response.body.version).toBe(3));
    expect(source.documents.get('orgs/tenant-a/projects/project-a').version).toBe(3);

    source.documents.set('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06', {
      requestId: 'project-a-2026-06', projectId: 'project-a', yearMonth: '2026-06', status: 'PENDING',
    });
    await request(app)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .set('idempotency-key', 'replace-pending-approver')
      .send({ approverUid: 'finance-1', yearMonth: '2026-07', expectedVersion: 3 })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approver_locked'));
  });

  it('rejects inactive and self approvers but lets any active member designate one', async () => {
    const source = fullMonthCloseSource();
    source.documents.get('orgs/tenant-a/projects/project-a').version = 2;
    source.documents.get('orgs/tenant-a/members/finance-2').status = 'INACTIVE';
    const requester = createApp(vi.fn(), createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db }).app;

    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .send({ approverUid: 'finance-2', yearMonth: '2026-07', expectedVersion: 2 })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_member_inactive'));
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .send({ approverUid: 'pm-1', yearMonth: '2026-07', expectedVersion: 2 })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_self_approval_forbidden'));

    const outsider = createApp(vi.fn(), createIdempotencyService(), {
      actorId: 'viewer-2', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(outsider)
      .post('/api/v1/cashflow/project-a/month-close/approver')
      .send({ approverUid: 'finance-1', yearMonth: '2026-07', expectedVersion: 2 })
      .expect(200)
      .expect((response) => expect(response.body.executiveApproverId).toBe('finance-1'));
  });

  it('derives the approver from the project, blocks self approval, and exposes permission-filtered reads', async () => {
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
          : {}),
    }));
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'canonical-approver-request')
      .send({
        approverUid: 'viewer-2',
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202)
      .expect((response) => expect(response.body.approverUid).toBe('finance-1'));

    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        documentType: 'MONTHLY_CLOSE', status: 'PENDING', approverUid: 'finance-1',
      }));
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(approver)
      .get('/api/v1/cashflow/month-close/requests/pending')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        count: 1,
        items: [{
          documentType: 'MONTHLY_CLOSE', requestId: 'project-a-2026-06', requestedByUid: 'pm-1',
          requestedByName: 'Project Manager', approverName: 'Finance One',
          requestedAt: '2026-07-10T00:00:00.000Z',
        }],
      }));
    delete source.documents.get('orgs/tenant-a/members/pm-1').name;
    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        requestedByName: '구성원 이름 확인 불가', approverName: 'Finance One',
      }));
    const outsider = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'viewer-2', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(outsider)
      .get('/api/v1/cashflow/month-close/requests/pending')
      .expect(200)
      .expect((response) => expect(response.body).toEqual({ items: [], count: 0 }));
    await request(outsider)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-06')
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_forbidden'));
    await request(outsider)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-06/review')
      .set('idempotency-key', 'outsider-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approver_mismatch'));
    source.documents.delete('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06');
    await request(outsider)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'outsider-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202)
      .expect((response) => expect(response.body).toMatchObject({
        status: 'PENDING', requestedByUid: 'viewer-2', approverUid: 'finance-1',
      }));
    await request(outsider)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-06')
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({ requestId: 'project-a-2026-06' }));

    source.documents.delete('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06');
    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-2';
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'stale-selected-approver-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approver_stale'));
    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-1';
    const selfRequester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(selfRequester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'self-approval-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_self_approval_forbidden'));

    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-2';
    source.documents.get('orgs/tenant-a/members/finance-2').status = 'INACTIVE';
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'inactive-approver-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-2', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_member_inactive'));

    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-1';
    source.documents.get('orgs/tenant-a/members/pm-1').status = 'INACTIVE';
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'inactive-requester-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_member_inactive'));
  });

  it('lets only the saved designated approver review and closes only after approval', async () => {
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
          : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
    }));
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const payload = {
      approverUid: 'finance-1', yearMonth: '2026-06', expectedRevision: 0,
      expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
      expectedOpeningBalances: read.body.dashboard.openingBalances,
      closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
    };
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-request-2')
      .send(payload)
      .expect(202);

    const wrongApprover = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-2', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    await request(wrongApprover)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-wrong')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approver_mismatch'));

    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-2';
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-former-approver')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approver_mismatch'));
    source.documents.get('orgs/tenant-a/projects/project-a').executiveApproverId = 'finance-1';
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-approve')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => {
        expect(response.body.request).toMatchObject({ status: 'APPROVED', revision: 1, reviewedByUid: 'finance-1' });
        expect(response.body.monthClose).toMatchObject({ status: 'CLOSED', revision: 1 });
      });

    const closeCalls = fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST');
    expect(closeCalls).toHaveLength(1);
    expect(JSON.parse(closeCalls[0][1].body).idempotencyKey).toBe('cashflow-month-close-approval:project-a-2026-06:r1');
  });

  it.each([
    ['body', null],
    ['ok', { ok: false, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }],
    ['projectId', { ok: true, projectId: 'project-b', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }],
    ['yearMonth', { ok: true, projectId: 'project-a', yearMonth: '2026-05', status: 'CLOSED', revision: 1, auditId: 'audit-1' }],
    ['status', { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 1, auditId: 'audit-1' }],
    ['revision mismatch', { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 2, auditId: 'audit-1' }],
    ['revision', { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: Number.MAX_SAFE_INTEGER + 1, auditId: 'audit-1' }],
    ['revision range', { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: -1, auditId: 'audit-1' }],
    ['auditId', { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: ' ' }],
  ])('records an uncertain retryable state when the JVM month-close mutation returns an invalid %s and canonical read is not closed', async (_field, mutationResponse) => {
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
          : mutationResponse),
    }));
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', `invalid-jvm-response-request-${_field}`)
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', `invalid-jvm-response-review-${_field}`)
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(503)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_reconciliation_pending'));

    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'UNCERTAIN',
      revision: 1,
      reconciliationEvidence: {
        outcome: 'DRIFTED',
        mutationErrorCode: 'cashflow_jvm_invalid_response',
        expected: { projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1 },
        observed: { projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0 },
      },
    });
    expect(source.documents.has('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-06-r1-approved')).toBe(false);
  });

  it.each([
    ['reset after commit', 'reset'],
    ['empty 200 after commit', 'empty'],
    ['drifted 200 after commit', 'drift'],
  ])('reconciles %s from the canonical CLOSED month without replaying approval validation', async (_label, failureMode) => {
    const source = fullMonthCloseSource();
    let mutationStarted = false;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/month-close') && init.method === 'POST') {
        mutationStarted = true;
        if (failureMode === 'reset') throw new Error('connection reset after commit');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(failureMode === 'empty'
            ? null
            : { ok: true, projectId: 'project-b', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source')
          ? monthDashboardSource({
            ok: true,
            projectId: 'project-a',
            yearMonth: '2026-06',
            status: mutationStarted ? 'CLOSED' : 'OPEN',
            revision: mutationStarted ? 1 : 0,
            reopenCount: 0,
            projectWarningCount: 0,
            snapshot: {},
          })
          : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
      };
    });
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', `reconcile-${failureMode}-request`)
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', `reconcile-${failureMode}-review`)
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        request: { status: 'APPROVED', revision: 1 },
        monthClose: { projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1 },
      }));
  });

  it('keeps reconciliation evidence retryable when the canonical post-mutation read fails', async () => {
    const source = fullMonthCloseSource();
    let mutationStarted = false;
    let canonicalReadAvailable = false;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/month-close') && init.method === 'POST') {
        mutationStarted = true;
        throw new Error('connection reset after commit');
      }
      if (mutationStarted && !canonicalReadAvailable && url.includes('/dashboard-source')) throw new Error('canonical read unavailable');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source')
          ? monthDashboardSource({
            ok: true, projectId: 'project-a', yearMonth: '2026-06',
            status: mutationStarted ? 'CLOSED' : 'OPEN', revision: mutationStarted ? 1 : 0,
            reopenCount: 0, projectWarningCount: 0, snapshot: {},
          })
          : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
      };
    });
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'reconcile-read-failure-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'reconcile-read-failure-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(503)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_reconciliation_pending'));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'UNCERTAIN',
      reconciliationEvidence: { outcome: 'READ_FAILED' },
    });
    const mutationCallsBeforeRetry = fetchImpl.mock.calls.filter(
      ([url, init]) => url.endsWith('/month-close') && init.method === 'POST',
    ).length;
    canonicalReadAvailable = true;
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'reconcile-read-failure-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request.status).toBe('APPROVED'));
    expect(fetchImpl.mock.calls.filter(
      ([url, init]) => url.endsWith('/month-close') && init.method === 'POST',
    )).toHaveLength(mutationCallsBeforeRetry);
  });

  it('resumes an APPROVING request with the same JVM idempotency key after finalization fails', async () => {
    const source = fullMonthCloseSource();
    const appliedKeys = new Set();
    let closeEffectCount = 0;
    let invalidRetry = false;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith('/month-close') && init.method === 'POST') {
        const key = JSON.parse(init.body).idempotencyKey;
        if (!appliedKeys.has(key)) {
          appliedKeys.add(key);
          closeEffectCount += 1;
        }
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1,
            auditId: invalidRetry ? '' : 'audit-1',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source')
          ? monthDashboardSource({
            ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
            reopenCount: 0, projectWarningCount: 0, snapshot: {},
          })
          : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
      };
    });
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'crash-window-request')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    const baseRunTransaction = source.db.runTransaction;
    let transactionCount = 0;
    source.db.runTransaction = async (callback) => {
      transactionCount += 1;
      if (transactionCount === 2) throw new Error('simulated finalization crash');
      return baseRunTransaction(callback);
    };
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const reviewPath = `/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`;

    await request(approver)
      .post(reviewPath)
      .set('idempotency-key', 'crash-window-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(500);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'APPROVING', revision: 1, reviewIdempotencyKey: 'crash-window-review',
    });
    await request(approver)
      .get('/api/v1/cashflow/month-close/requests/pending')
      .expect(200)
      .expect((response) => expect(response.body).toMatchObject({
        count: 1,
        items: [{ requestId: 'project-a-2026-06', status: 'APPROVING', revision: 1 }],
      }));
    invalidRetry = true;
    await request(approver)
      .post(reviewPath)
      .set('idempotency-key', 'crash-window-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(503)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_reconciliation_pending'));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-06')).toMatchObject({
      status: 'UNCERTAIN', revision: 1,
    });
    invalidRetry = false;
    await request(approver)
      .post(reviewPath)
      .set('idempotency-key', 'crash-window-review')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({ status: 'APPROVED', revision: 1 }));

    const closeKeys = fetchImpl.mock.calls
      .filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')
      .map(([, init]) => JSON.parse(init.body).idempotencyKey);
    expect(closeKeys).toEqual([
      'cashflow-month-close-approval:project-a-2026-06:r1',
      'cashflow-month-close-approval:project-a-2026-06:r1',
      'cashflow-month-close-approval:project-a-2026-06:r1',
    ]);
    expect(closeEffectCount).toBe(1);
  });

  it('rejects duplicate review but allows a rejected request to be revised and resubmitted', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : init.method === 'POST'
          ? { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }
          : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
    }));
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-request-reject')
      .send({
        approverUid: 'finance-1', yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-reject')
      .send({ decision: 'REJECT', expectedRevision: 0, reason: '입금 근거 재확인 필요' })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({ status: 'REJECTED', revision: 1 }));
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-duplicate')
      .send({ decision: 'APPROVE', expectedRevision: 1 })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_already_reviewed'));
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);

    const resubmitted = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-request-resubmitted')
      .send({
        yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    expect(resubmitted.body).toMatchObject({ status: 'PENDING', revision: 2, approverUid: 'finance-1' });
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-06-r2-resubmitted')).toMatchObject({
      action: 'RESUBMITTED', revision: 2, actorUid: 'pm-1',
    });
    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-resubmitted')
      .send({ decision: 'APPROVE', expectedRevision: 2 })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({ status: 'APPROVED', revision: 3 }));
    const closeCalls = fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST');
    expect(closeCalls).toHaveLength(1);
    expect(JSON.parse(closeCalls[0][1].body).idempotencyKey).toBe('cashflow-month-close-approval:project-a-2026-06:r3');
  });

  it('approves from stored evidence when live publication and dashboard sources change or disappear', async () => {
    const source = fullMonthCloseSource();
    let allowDashboardSource = true;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.includes('/dashboard-source') && !allowDashboardSource) {
        throw new Error('dashboard source must not be read after request creation');
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(url.includes('/dashboard-source')
          ? monthDashboardSource({
            ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
            reopenCount: 0, projectWarningCount: 0, snapshot: {},
          })
          : init.method === 'POST'
            ? { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }
            : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
      };
    });
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;
    const read = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-request-stored-evidence')
      .send({
        approverUid: 'finance-1', yearMonth: '2026-06', expectedRevision: 0,
        expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    source.documents.delete('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    source.documents.set('orgs/tenant-a/cashflow_sheet_publications/project-a', {
      status: 'APPLYING', stagedRunId: 'post-request-run',
    });
    allowDashboardSource = false;
    const dashboardReadsBeforeApproval = fetchImpl.mock.calls.filter(([url]) => url.includes('/dashboard-source')).length;
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-review-stored-evidence')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'APPROVED', monthSnapshot: created.body.monthSnapshot,
      }));
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/dashboard-source'))).toHaveLength(dashboardReadsBeforeApproval);
    expect(created.body.monthSnapshot.source).toMatchObject({
      spreadsheetId: 'spreadsheet-a',
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: 'cashflow(사용내역 연동)',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit',
    });
    const closeBody = JSON.parse(fetchImpl.mock.calls.find(
      ([url, init]) => url.endsWith('/month-close') && init.method === 'POST',
    )[1].body);
    const snapshotCells = ['projection', 'actual'].flatMap((mode) => (
      created.body.monthSnapshot[mode].weeks.flatMap((week) => week.cells.map((cell) => ({
        mode,
        weekNo: week.weekNo,
        cashflowLine: cell.cashflowLine,
        cellState: cell.cellState,
        amount: cell.amount,
        sourceCell: null,
        sourceLabel: null,
      })))
    ));
    expect(closeBody).toMatchObject({
      expectedRevision: 0,
      sourceRevision: source.closeInput.sourceRevision,
      targetRevision: source.closeInput.targetRevision,
    });
    expect(closeBody).not.toHaveProperty('reviewWarnings');
    expect(closeBody.cells).toEqual(snapshotCells);
  });

  it('rejects, resubmits, and replays a verified 44-month cumulative v2 request without live evidence', async () => {
    const source = fullMonthCloseSource();
    const runTransaction = source.db.runTransaction;
    let transactionTail = Promise.resolve();
    source.db.runTransaction = (callback) => {
      const result = transactionTail.then(() => runTransaction(callback));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    };
    source.closeInput.yearMonth = '2026-08';
    const mirror = source.documents.get('orgs/tenant-a/cashflow_sheet_mirrors/project-a');
    mirror.yearMonths = ['2026-08'];
    mirror.cells.forEach((cell) => { cell.yearMonth = '2026-08'; });
    mirror.sheetFacts.depositScheduleRows.forEach((row) => { row.yearMonth = '2026-08'; });
    const months = [];
    for (let year = 2023, month = 1; year < 2026 || month <= 8; month += 1) {
      if (month === 13) { year += 1; month = 1; }
      months.push({ yearMonth: `${year}-${String(month).padStart(2, '0')}`, projection: { weeks: [] }, actual: { weeks: [] } });
    }
    const cashflow = { projectId: 'project-a', projection: [], actual: [], readModel: { months } };
    let closedMonthClose = null;
    let dashboardSourceUnavailable = false;
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.includes('/dashboard-source')) {
        if (dashboardSourceUnavailable) throw new Error('live dashboard source drifted after persistence');
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(monthDashboardSource(closedMonthClose || {
            ok: true, projectId: 'project-a', yearMonth: '2026-08', status: 'OPEN', revision: 0,
            reopenCount: 0, projectWarningCount: 0, snapshot: {},
          }, cashflow)),
        };
      }
      if (init.method === 'POST') {
        const closeBody = JSON.parse(init.body);
        closedMonthClose = {
          ok: true, projectId: 'project-a', requestId: 'project-a-2026-08', requestRevision: closeBody.requestRevision,
          manifestHash: closeBody.manifestHash, yearMonth: '2026-08', status: 'CLOSED',
          revision: 1, rootHash: closeBody.manifestHash, headRevision: 44, auditId: `audit-cumulative-${closeBody.requestRevision}`,
        };
        return { ok: true, status: 200, text: async () => JSON.stringify(closedMonthClose) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(cashflow) };
    });
    let failShardOnce = true;
    const baseDoc = source.db.doc;
    source.db.doc = (path) => {
      const ref = baseDoc(path);
      if (!path.includes('/cashflow_month_close_request_months/') || !path.endsWith('-2024-01')) return ref;
      return {
        ...ref,
        beforeTransactionSet: () => {
          if (failShardOnce) {
            failShardOnce = false;
            throw new Error('injected shard write failure');
          }
        },
      };
    };
    const requester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-09-10T00:00:00.000Z') }).app;
    const dashboard = await request(requester).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-08').expect(200);
    const createPayload = {
      contractVersion: 'cashflow-cumulative-close-v2',
      yearMonth: '2026-08', expectedRevision: 0,
      expectedApproverUid: 'finance-1', expectedProjectVersion: 0,
      expectedOpeningBalances: dashboard.body.dashboard.openingBalances,
      closeInput: { ...source.closeInput, managementChecks: dashboard.body.dashboard.managementChecks },
    };
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'cumulative-v2-create')
      .send(createPayload)
      .expect(500);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08')).toBeUndefined();
    expect([...source.documents.keys()].filter((path) => path.includes('/cashflow_month_close_request_months/'))).toHaveLength(0);
    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-08')
      .expect(200)
      .expect((response) => expect(response.body.request).toBeNull());
    const serializedRunTransaction = source.db.runTransaction;
    const retryConflict = new Error('simulated Firestore transaction retry');
    let retryOnce = true;
    source.db.runTransaction = async (callback) => {
      if (retryOnce) {
        retryOnce = false;
        try {
          await serializedRunTransaction(async (transaction) => {
            await callback(transaction);
            throw retryConflict;
          });
        } catch (error) {
          if (error !== retryConflict) throw error;
        }
      }
      return serializedRunTransaction(callback);
    };
    const created = await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'cumulative-v2-create')
      .send(createPayload)
      .expect(202);
    expect(created.body).toMatchObject({
      documentType: 'MONTHLY_CLOSE', contractVersion: 'cashflow-cumulative-close-v2', status: 'PENDING', monthCount: 44,
      weekCount: 220, cellCount: 7040,
      fromMonth: '2023-01', yearMonth: '2026-08', revision: 1,
      source: { spreadsheetId: 'spreadsheet-a', selectedSheetName: 'cashflow(사용내역 연동)' },
      totals: { projection: 0, actual: 0, difference: 0 },
      annualSummaries: [
        { year: 2023, monthCount: 12, projection: 0, actual: 0, difference: 0 },
        { year: 2024, monthCount: 12, projection: 0, actual: 0, difference: 0 },
        { year: 2025, monthCount: 12, projection: 0, actual: 0, difference: 0 },
        { year: 2026, monthCount: 8, projection: 0, actual: 0, difference: 0 },
      ],
    });
    expect(created.body.monthSnapshot).toBeNull();
    let shardDocs = [...source.documents.entries()].filter(([path]) => path.includes('/cashflow_month_close_request_months/'));
    expect(shardDocs).toHaveLength(44);
    expect(shardDocs.every(([, shard]) => shard.cells.length === 160)).toBe(true);
    expect(shardDocs.reduce((count, [, shard]) => count + shard.cells.length, 0)).toBe(7040);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-08-r1-requested')).toMatchObject({
      action: 'REQUESTED', revision: 1, actorUid: 'pm-1', manifestHash: created.body.manifestHash,
    });

    const requestPath = 'orgs/tenant-a/cashflow_month_close_requests/project-a-2026-08';
    const legacyBuilding = { ...source.documents.get(requestPath), status: 'BUILDING' };
    delete legacyBuilding.requestFingerprint;
    source.documents.set(requestPath, legacyBuilding);
    for (const path of [...source.documents.keys()]) {
      if (path.includes('/cashflow_month_close_request_months/') || path.endsWith('-r1-requested')) {
        source.documents.delete(path);
      }
    }
    const legacyRequester = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1', actorRole: 'pm',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-09-10T00:00:00.000Z') }).app;
    const legacyRecovery = await request(legacyRequester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'cumulative-v2-create')
      .send(createPayload);
    expect(legacyRecovery.status, JSON.stringify(legacyRecovery.body)).toBe(202);
    shardDocs = [...source.documents.entries()].filter(([path]) => path.includes('/cashflow_month_close_request_months/'));
    expect(shardDocs).toHaveLength(44);
    expect(source.documents.get(requestPath)).toMatchObject({ status: 'PENDING', requestFingerprint: expect.any(String) });

    const firstShard = shardDocs[0][1];
    firstShard.cells[0].amount = 1;
    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/months?limit=1')
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_evidence_tampered'));
    firstShard.cells[0].amount = null;
    const unrelated = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'viewer-2', actorRole: 'viewer',
    }, { env: runtimeEnv, db: source.db }).app;
    await request(unrelated)
      .get('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/months?limit=1')
      .expect(403);

    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/months?limit=12')
      .expect(200)
      .expect((response) => {
        expect(response.body.months).toHaveLength(12);
        expect(response.body.nextCursor).toBe('2024-01');
      });
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-09-10T00:00:00.000Z') }).app;
    const r1Shards = new Map(shardDocs.map(([path, shard]) => [path, JSON.stringify(shard)]));
    const rejectedResponse = await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-reject')
      .send({ decision: 'REJECT', reason: '누적 근거를 다시 확인해 주세요.', expectedRevision: 1, expectedManifestHash: created.body.manifestHash })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'REJECTED', revision: 1, manifestHash: created.body.manifestHash,
        decisionReason: '누적 근거를 다시 확인해 주세요.',
      }));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-08-r1-rejected')).toMatchObject({
      action: 'REJECTED', revision: 1, actorUid: 'finance-1', reason: '누적 근거를 다시 확인해 주세요.',
    });
    const rejectedReplayBody = {
      decision: 'REJECT', reason: '누적 근거를 다시 확인해 주세요.',
      expectedRevision: 1, expectedManifestHash: created.body.manifestHash,
    };
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-reject')
      .send(rejectedReplayBody)
      .expect(200)
      .expect((response) => expect(response.body).toEqual(rejectedResponse.body));
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-reject-duplicate')
      .send(rejectedReplayBody)
      .expect(409);
    await request(requester)
      .get('/api/v1/cashflow/project-a/month-close/requests/current?yearMonth=2026-08')
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'REJECTED', revision: 1, decisionReason: '누적 근거를 다시 확인해 주세요.',
      }));

    const resubmitAttempts = await Promise.all(['cumulative-v2-resubmit-a', 'cumulative-v2-resubmit-b'].map((key) => (
      request(requester)
        .post('/api/v1/cashflow/project-a/month-close/requests')
        .set('idempotency-key', key)
        .send(createPayload)
    )));
    expect(resubmitAttempts.map(({ status }) => status).sort()).toEqual([202, 409]);
    expect(resubmitAttempts.find(({ status }) => status === 409)?.body.code).toBe('cashflow_month_close_request_conflict');
    const resubmitted = resubmitAttempts.find(({ status }) => status === 202);
    const winningResubmitKey = resubmitAttempts[0].status === 202 ? 'cumulative-v2-resubmit-a' : 'cumulative-v2-resubmit-b';
    expect(resubmitted.body).toMatchObject({ status: 'PENDING', revision: 2, monthCount: 44 });
    expect(resubmitted.body.manifestHash).not.toBe(created.body.manifestHash);
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-08-r2-resubmitted')).toMatchObject({
      action: 'RESUBMITTED', revision: 2, actorUid: 'pm-1', manifestHash: resubmitted.body.manifestHash,
    });
    expect([...r1Shards].every(([path, json]) => JSON.stringify(source.documents.get(path)) === json)).toBe(true);
    expect([...source.documents.keys()].filter((path) => path.includes('/cashflow_month_close_request_months/project-a-2026-08-r2-'))).toHaveLength(44);
    const dashboardSourceCallCount = fetchImpl.mock.calls.filter(([url]) => url.includes('/dashboard-source')).length;
    dashboardSourceUnavailable = true;
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', winningResubmitKey)
      .send(createPayload)
      .expect(202)
      .expect((response) => expect(response.body).toMatchObject({ status: 'PENDING', revision: 2, manifestHash: resubmitted.body.manifestHash }));
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/dashboard-source'))).toHaveLength(dashboardSourceCallCount);
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', winningResubmitKey)
      .send({ ...createPayload, closeInput: undefined })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_conflict'));
    await request(requester)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', winningResubmitKey)
      .send({ ...createPayload, expectedOpeningBalances: { ...createPayload.expectedOpeningBalances, projection: { amount: 1 } } })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_conflict'));
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/dashboard-source'))).toHaveLength(dashboardSourceCallCount);
    dashboardSourceUnavailable = false;
    await request(approver)
      .get('/api/v1/cashflow/month-close/requests/pending')
      .expect(200)
      .expect((response) => {
        expect(response.body.count).toBe(1);
        expect(response.body.items).toHaveLength(1);
        expect(response.body.items[0]).toMatchObject({ requestId: created.body.requestId, revision: 2 });
      });
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-stale-approve')
      .send({ decision: 'APPROVE', expectedRevision: 1, expectedManifestHash: created.body.manifestHash })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_request_manifest_invalid'));
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);

    const approvedResponse = await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-approve')
      .send({ decision: 'APPROVE', expectedRevision: 2, expectedManifestHash: resubmitted.body.manifestHash })
      .expect(200)
      .expect((response) => expect(response.body.request).toMatchObject({
        status: 'APPROVED', revision: 2, manifestHash: resubmitted.body.manifestHash,
      }));
    expect(source.documents.get('orgs/tenant-a/cashflow_month_close_request_audits/project-a-2026-08-r2-approved')).toMatchObject({
      action: 'APPROVED', revision: 2, actorUid: 'finance-1', manifestHash: resubmitted.body.manifestHash,
    });
    const approvalBody = JSON.parse(fetchImpl.mock.calls.find(
      ([url, init]) => url.endsWith('/month-close') && init.method === 'POST',
    )[1].body);
    expect(approvalBody).toEqual({
      idempotencyKey: 'cashflow-month-close-approval:project-a-2026-08:r2',
      requestId: 'project-a-2026-08', requestRevision: 2, manifestHash: resubmitted.body.manifestHash,
      yearMonth: '2026-08', expectedRevision: 0,
    });
    const closePostCount = () => fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST').length;
    expect(closePostCount()).toBe(1);
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-approve')
      .send({ decision: 'APPROVE', expectedRevision: 2, expectedManifestHash: resubmitted.body.manifestHash })
      .expect(200)
      .expect((response) => expect(response.body).toEqual(approvedResponse.body));
    expect(closePostCount()).toBe(1);
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'cumulative-v2-approve-duplicate')
      .send({ decision: 'APPROVE', expectedRevision: 2, expectedManifestHash: resubmitted.body.manifestHash })
      .expect(409);
    for (const status of ['APPROVING', 'UNCERTAIN']) {
      source.documents.set(requestPath, {
        ...source.documents.get(requestPath),
        status,
        reviewedByUid: 'finance-1',
        reviewedAt: '2026-09-10T00:00:00.000Z',
        reviewIdempotencyKey: `prior-${status.toLowerCase()}`,
        approvalId: 'cashflow-month-close:project-a-2026-08:r2',
        operationId: 'cashflow-month-close:project-a-2026-08:r2',
      });
      await request(approver)
        .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
        .set('idempotency-key', `resume-${status.toLowerCase()}`)
        .send({ decision: 'APPROVE', expectedRevision: 2, expectedManifestHash: resubmitted.body.manifestHash })
        .expect(200)
        .expect((response) => expect(response.body.request).toMatchObject({ status: 'APPROVED', revision: 2 }));
      expect(closePostCount()).toBe(1);
    }
    source.documents.set(requestPath, { ...source.documents.get(requestPath), status: 'UNCERTAIN' });
    await request(approver)
      .post('/api/v1/cashflow/project-a/month-close/requests/project-a-2026-08/review')
      .set('idempotency-key', 'unsafe-reject-after-approval-start')
      .send({ decision: 'REJECT', reason: '취소', expectedRevision: 2, expectedManifestHash: resubmitted.body.manifestHash })
      .expect(409);
  });

  it('blocks the legacy direct month-close mutation route', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1', actorRole: 'admin',
    }, { env: runtimeEnv, db: source.db, now: () => new Date('2026-07-10T00:00:00.000Z') });
    const read = await request(app).get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06').expect(200);

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'legacy-direct-close')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedApproverUid: 'finance-1',
        expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_month_close_approval_required'));
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(0);
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
    }, { env: { ...runtimeEnv, BFF_EDIT_LEASES_ENABLED: 'false' } });

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
    expect(init.headers['x-data-project-id']).toBe('live-data-project');
    expect(JSON.parse(init.body)).toEqual({
      idempotencyKey: 'month-reopen-request-1',
      yearMonth: '2026-06',
      expectedRevision: 4,
      reason: '증빙 정정 필요',
    });
  });

  it('blocks month close while a sheet publication is APPLYING', async () => {
    const source = fullMonthCloseSource();
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED' }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });
    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    source.documents.set('orgs/tenant-a/cashflow_sheet_publications/project-a', {
      projectId: 'project-a',
      status: 'APPLYING',
      stagedRunId: 'run-in-flight',
      sourceRevision: `sha256:${'a'.repeat(64)}`,
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-publication-applying')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_apply_in_progress');
      });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the sheet publication changes during month-close preflight', async () => {
    const source = fullMonthCloseSource();
    let publicationReadCount = 0;
    let publicationRaceActive = false;
    const baseDoc = source.db.doc;
    source.db.doc = (path) => {
      if (!publicationRaceActive || path !== 'orgs/tenant-a/cashflow_sheet_publications/project-a') return baseDoc(path);
      return {
        get: async () => {
          publicationReadCount += 1;
          return {
            exists: true,
            data: () => ({
              projectId: 'project-a',
              status: 'APPLIED',
              stagedRunId: publicationReadCount < 2 ? 'run-before' : 'run-after',
              sourceRevision: `sha256:${'a'.repeat(64)}`,
            }),
          };
        },
      };
    };
    const fetchImpl = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(monthDashboardSource({
        ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
        reopenCount: 0, projectWarningCount: 0, snapshot: {},
      })),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });
    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    publicationRaceActive = true;
    publicationReadCount = 0;

    await request(app)
      .post('/api/v1/cashflow/project-a/month-close')
      .set('idempotency-key', 'month-close-publication-preflight-race')
      .send({
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_publication_changed');
      });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not reread live publication state after a month-close request exists', async () => {
    const source = fullMonthCloseSource();
    let publicationReadCount = 0;
    let publicationRaceActive = false;
    const baseDoc = source.db.doc;
    source.db.doc = (path) => {
      if (!publicationRaceActive || path !== 'orgs/tenant-a/cashflow_sheet_publications/project-a') return baseDoc(path);
      return {
        get: async () => {
          publicationReadCount += 1;
          return {
            exists: true,
            data: () => ({
              projectId: 'project-a',
              status: 'APPLIED',
              stagedRunId: publicationReadCount < 3 ? 'run-stable' : 'run-changed',
              sourceRevision: `sha256:${'a'.repeat(64)}`,
            }),
          };
        },
      };
    };
    const fetchImpl = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(url.includes('/dashboard-source')
        ? monthDashboardSource({
          ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'OPEN', revision: 0,
          reopenCount: 0, projectWarningCount: 0, snapshot: {},
        })
        : init.method === 'POST'
          ? { ok: true, projectId: 'project-a', yearMonth: '2026-06', status: 'CLOSED', revision: 1, auditId: 'audit-1' }
          : { projectId: 'project-a', projection: [], actual: [], readModel: { months: [] } }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    });
    const read = await request(app)
      .get('/api/v1/cashflow/project-a/month-close?yearMonth=2026-06')
      .expect(200);
    const created = await request(app)
      .post('/api/v1/cashflow/project-a/month-close/requests')
      .set('idempotency-key', 'month-close-publication-request')
      .send({
        approverUid: 'finance-1',
        yearMonth: '2026-06',
        expectedRevision: 0,
        expectedApproverUid: 'finance-1',
        expectedProjectVersion: 0,
        expectedOpeningBalances: read.body.dashboard.openingBalances,
        closeInput: { ...source.closeInput, managementChecks: read.body.dashboard.managementChecks },
      })
      .expect(202);
    publicationRaceActive = true;
    publicationReadCount = 0;
    const approver = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1', actorRole: 'finance',
    }, {
      env: runtimeEnv,
      db: source.db,
      now: () => new Date('2026-07-10T00:00:00.000Z'),
    }).app;

    await request(approver)
      .post(`/api/v1/cashflow/project-a/month-close/requests/${created.body.requestId}/review`)
      .set('idempotency-key', 'month-close-publication-mutation-race')
      .send({ decision: 'APPROVE', expectedRevision: 0 })
      .expect(200)
      .expect((response) => expect(response.body.request.status).toBe('APPROVED'));

    expect(publicationReadCount).toBe(0);
    expect(fetchImpl.mock.calls.filter(([url, init]) => url.endsWith('/month-close') && init.method === 'POST')).toHaveLength(1);
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
      }, { env: runtimeEnv });

      await request(app)
        .post('/api/v1/cashflow/project-a/month-close/reopen-decision')
        .set('idempotency-key', `month-reopen-decision-${actorRole}`)
        .send({ yearMonth: '2026-06', expectedRevision: 5, decision: 'APPROVE', reason: '확인 완료' })
        .expect(200);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a/month-close/reopen-decision');
      expect(init.headers['x-actor-role']).toBe(actorRole);
      expect(init.headers['x-edit-session-id']).toBeUndefined();
      expect(init.headers['x-data-project-id']).toBe('live-data-project');
      expect(JSON.parse(init.body)).toMatchObject({
        idempotencyKey: `month-reopen-decision-${actorRole}`,
        yearMonth: '2026-06',
        expectedRevision: 5,
        decision: 'APPROVE',
      });
    },
  );

  it.each([
    [{ ...runtimeEnv, BFF_DEPLOY_ENV: 'preview' }, 'unsafe_bff_runtime'],
    [{ ...runtimeEnv, JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'other-data-project' }, 'jvm_weekly_data_project_mismatch'],
  ])('blocks reopen writes before the JVM when runtime alignment fails', async (env, code) => {
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
    }, { env: runtimeEnv });

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
      }, { env: runtimeEnv });

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
      }, { env: runtimeEnv });

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
    }, { env: runtimeEnv });

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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv });

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
    const { app } = createApp(fetchImpl, idempotencyService, {}, { env: runtimeEnv });

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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv });

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

  it('adds an audience-bound ID token resolved from Live BFF credentials', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ projectId: 'project-a', projection: [], actual: [] }),
      };
    });
    const resolveIdentityToken = vi.fn(async () => 'live-id-token');
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      jvmWeeklyApiIdTokenAudience: 'https://innerplatform-jvm-weekly-api-live.a.run.app',
      jvmWeeklyApiServiceAccountJson: JSON.stringify({ client_email: 'live-invoker@example.iam.gserviceaccount.com' }),
      jvmWeeklyApiIdentityTokenResolver: resolveIdentityToken,
    });

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200);

    expect(resolveIdentityToken).toHaveBeenCalledWith(expect.objectContaining({
      audience: 'https://innerplatform-jvm-weekly-api-live.a.run.app',
      serviceAccountJson: JSON.stringify({ client_email: 'live-invoker@example.iam.gserviceaccount.com' }),
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.authorization).toBe('Bearer live-id-token');
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
    }, { env: runtimeEnv });
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
    }, { env: runtimeEnv });

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
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: runtimeEnv });

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

describe('cashflowMonthCloseDeadline', () => {
  it('is the tenth of the following month and rolls over the year in December', () => {
    expect(cashflowMonthCloseDeadline('2026-07')).toBe('2026-08-10');
    expect(cashflowMonthCloseDeadline('2026-09')).toBe('2026-10-10');
    // 12월은 다음 해 1월로 넘어간다. 자릿수도 두 자리를 유지해야 문자열 비교가 성립한다.
    expect(cashflowMonthCloseDeadline('2026-12')).toBe('2027-01-10');
    expect(cashflowMonthCloseDeadline('2026-01')).toBe('2026-02-10');
  });

  it('returns null for a malformed month instead of guessing', () => {
    expect(cashflowMonthCloseDeadline('not-a-month')).toBeNull();
    expect(cashflowMonthCloseDeadline('')).toBeNull();
  });
});
