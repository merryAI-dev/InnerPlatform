import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  buildPortalBankStatementsSummary,
  buildPortalDashboardSummary,
  buildPortalPayrollSummary,
  buildPortalWeeklyExpensesSummary,
  mountPortalReadModelRoutes,
} from './portal-read-model.mjs';

function createExpenseSheet(id, name, rows = []) {
  return {
    id,
    name,
    rows,
    order: 0,
  };
}

function createDocSnapshot(path, value) {
  const id = String(path).split('/').pop();
  return {
    id,
    exists: value !== undefined,
    data() {
      return value;
    },
  };
}

function createQuerySnapshot(path, docs) {
  return {
    path,
    docs: (Array.isArray(docs) ? docs : []).map((entry) => ({
      id: entry.id,
      data() {
        return entry.data;
      },
    })),
  };
}

function createFakeDb({ docs = {}, collections = {} } = {}) {
  const collectionReads = [];
  const queryReads = [];

  function applyFilters(entries, filters) {
    return filters.reduce((current, filter) => current.filter((entry) => {
      if (filter.op !== '==') return false;
      return entry.data?.[filter.field] === filter.expectedValue;
    }), Array.isArray(entries) ? entries : []);
  }

  function createQuery(path, baseDocs, filters = []) {
    return {
      doc(id) {
        return {
          async get() {
            return createDocSnapshot(`${path}/${id}`, docs[`${path}/${id}`]);
          },
        };
      },
      where(field, op, expectedValue) {
        return createQuery(path, baseDocs, [...filters, { field, op, expectedValue }]);
      },
      async get() {
        queryReads.push({
          path,
          filters: filters.map((filter) => ({ ...filter })),
        });
        return createQuerySnapshot(path, applyFilters(baseDocs, filters));
      },
    };
  }

  return {
    collectionReads,
    queryReads,
    doc(path) {
      return {
        async get() {
          return createDocSnapshot(path, docs[path]);
        },
      };
    },
    collection(path) {
      collectionReads.push(path);
      const baseDocs = collections[path] || [];
      return createQuery(path, baseDocs);
    },
  };
}

describe('portal read-model helpers', () => {
  it('builds a dashboard summary from compact portal state', () => {
    const result = buildPortalDashboardSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
        managerName: '보람',
        clientOrg: 'MYSC',
        status: 'IN_PROGRESS',
        settlementType: 'TYPE1',
        basis: '공급가액',
        contractAmount: 3000000,
      },
      projects: [
        {
          id: 'p001',
          name: '알파 프로젝트',
          shortName: '알파',
          contractAmount: 3000000,
        },
        {
          id: 'p002',
          name: '베타 프로젝트',
          shortName: '베타',
        },
      ],
      todayIso: '2026-04-16',
      payrollRiskCount: 2,
      transactions: [
        {
          id: 'tx-in',
          projectId: 'p001',
          direction: 'IN',
          amounts: { bankAmount: 3000000 },
        },
        {
          id: 'tx-out',
          projectId: 'p001',
          direction: 'OUT',
          amounts: { bankAmount: 1250000 },
        },
      ],
      weeklySubmissionStatuses: [
        {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          yearMonth: '2026-04',
          weekNo: 3,
          projectionEdited: true,
          projectionUpdated: true,
          expenseEdited: false,
          expenseUpdated: false,
          expenseReviewPendingCount: 1,
          projectionUpdatedAt: '2026-04-16T02:00:00.000Z',
        },
        {
          id: 'p002-2026-04-w3',
          projectId: 'p002',
          yearMonth: '2026-04',
          weekNo: 3,
          projectionEdited: false,
          projectionUpdated: false,
          expenseEdited: true,
          expenseUpdated: true,
          expenseReviewPendingCount: 0,
          projectionUpdatedAt: '2026-04-15T02:00:00.000Z',
        },
      ],
      visibleProjects: 3,
      hrAlertCount: 1,
      hrAlerts: [
        {
          id: 'alert-1',
          projectId: 'p001',
          employeeName: '보람',
          eventType: 'RESIGNATION',
          effectiveDate: '2026-04-20',
          acknowledged: false,
          createdAt: '2026-04-16T09:00:00.000Z',
        },
        {
          id: 'alert-2',
          projectId: 'p001',
          employeeName: '하모니',
          eventType: 'TRANSFER',
          effectiveDate: '2026-04-21',
          acknowledged: true,
          createdAt: '2026-04-16T08:00:00.000Z',
        },
      ],
    });

    expect(result.project.id).toBe('p001');
    expect(result.project).toMatchObject({
      settlementType: 'TYPE1',
      basis: '공급가액',
      contractAmount: 3000000,
      clientOrg: 'MYSC',
      managerName: '보람',
    });
    expect(result.surface.currentWeekLabel).toBe('3주차');
    expect(result.surface.visibleIssues.map((issue) => issue.label)).toContain('미확인 공지');
    expect(result.summary.payrollRiskCount).toBe(2);
    expect(result.summary.visibleProjects).toBe(3);
    expect(result.financeSummaryItems).toEqual([
      { label: '총 입금', value: '300만' },
      { label: '총 출금', value: '125만' },
      { label: '잔액', value: '175만' },
      { label: '소진율', value: '41.7%' },
    ]);
    expect(result.submissionRows).toEqual([
      {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
        projectionInputLabel: '입력됨',
        projectionDoneLabel: '제출 완료',
        expenseLabel: '저장 전 초안',
        expenseTone: 'warning',
        latestProjectionUpdatedAt: '2026-04-16T02:00:00.000Z',
      },
      {
        id: 'p002',
        name: '베타 프로젝트',
        shortName: '베타',
        projectionInputLabel: '미입력',
        projectionDoneLabel: '미완료',
        expenseLabel: '동기화 완료',
        expenseTone: 'success',
        latestProjectionUpdatedAt: '2026-04-15T02:00:00.000Z',
      },
    ]);
    expect(result.notices.hrAlerts.count).toBe(1);
    expect(result.notices.hrAlerts.items).toEqual([
      {
        id: 'alert-1',
        employeeName: '보람',
        eventType: 'RESIGNATION',
        effectiveDate: '2026-04-20',
        projectId: 'p001',
      },
    ]);
  });

  it('builds a payroll summary that exposes the current liquidity queue item', () => {
    const result = buildPortalPayrollSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      payrollSchedule: {
        id: 'p001',
        projectId: 'p001',
        dayOfMonth: 25,
        timezone: 'Asia/Seoul',
        noticeLeadBusinessDays: 3,
        active: true,
      },
      payrollRuns: [
        {
          id: 'p001-2026-03',
          projectId: 'p001',
          yearMonth: '2026-03',
          plannedPayDate: '2026-03-25',
          noticeDate: '2026-03-20',
          noticeLeadBusinessDays: 3,
          acknowledged: true,
          paidStatus: 'CONFIRMED',
          matchedTxIds: ['tx001'],
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'p001-2026-04',
          projectId: 'p001',
          yearMonth: '2026-04',
          plannedPayDate: '2026-04-25',
          noticeDate: '2026-04-22',
          noticeLeadBusinessDays: 3,
          acknowledged: false,
          paidStatus: 'MISSING',
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
      ],
      transactions: [
        {
          id: 'tx001',
          projectId: 'p001',
          state: 'APPROVED',
          dateTime: '2026-04-24T09:00:00.000Z',
          amounts: { bankAmount: 1200000, depositAmount: 0, expenseAmount: 1200000, vatIn: 0, vatOut: 0, vatRefund: 0, balanceAfter: 3400000 },
        },
      ],
      todayIso: '2026-04-26',
    });

    expect(result.schedule.dayOfMonth).toBe(25);
    expect(result.currentRun.plannedPayDate).toBe('2026-04-25');
    expect(result.summary.queueCount).toBe(1);
    expect(result.summary.status).toBe('payment_unconfirmed');
  });

  it('builds weekly expense and bank statement summaries with handoff metadata', () => {
    const weekly = buildPortalWeeklyExpensesSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      todayIso: '2026-04-16',
      weeklySubmissionStatuses: [
        {
          id: 'p001-2026-04-w3',
          projectId: 'p001',
          yearMonth: '2026-04',
          weekNo: 3,
          projectionEdited: true,
          projectionUpdated: true,
          expenseEdited: true,
          expenseUpdated: false,
          expenseReviewPendingCount: 2,
        },
      ],
      expenseSheets: [
        createExpenseSheet('default', '기본 탭', [{ tempId: 'r1', cells: ['a'] }]),
        createExpenseSheet('sheet-2', '보조 탭', []),
      ],
      activeExpenseSheetId: 'default',
      bankStatementRows: {
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'b1', cells: ['001', '2026-04-16'] }],
      },
      sheetSources: [
        { sourceType: 'bank_statement', sheetName: '통장내역', fileName: 'bank.xls', rowCount: 1, columnCount: 2, uploadedAt: '2026-04-16T09:00:00.000Z' },
      ],
    });

    expect(weekly.expenseSheet.sheetCount).toBe(2);
    expect(weekly.bankStatement.rowCount).toBe(1);
    expect(weekly.handoff.canOpenWeeklyExpenses).toBe(true);
    expect(weekly.summary.expenseReviewPendingCount).toBe(2);

    const bank = buildPortalBankStatementsSummary({
      project: {
        id: 'p001',
        name: '알파 프로젝트',
        shortName: '알파',
      },
      activeExpenseSheetId: 'default',
      expenseSheets: [
        createExpenseSheet('default', '기본 탭', [{ tempId: 'r1', cells: ['a'] }]),
      ],
      bankStatementRows: {
        columns: ['통장번호', '거래일시'],
        rows: [{ tempId: 'b1', cells: ['001', '2026-04-16'] }],
      },
    });

    expect(bank.bankStatement.profile).toBe('general');
    expect(bank.handoffContext.ready).toBe(true);
    expect(bank.handoffContext.nextPath).toBe('/portal/weekly-expenses');
  });

  it('registers the four portal read-model endpoints', () => {
    const routes = [];
    const app = {
      get(path, handler) {
        routes.push({ path, handler });
      },
    };

    mountPortalReadModelRoutes(app, {
      db: {},
    });

    expect(routes.map((route) => route.path)).toEqual([
      '/api/v1/portal/dashboard-summary',
      '/api/v1/portal/payroll-summary',
      '/api/v1/portal/weekly-expenses-summary',
      '/api/v1/portal/bank-statements-summary',
    ]);
  });

  it('serves dashboard summary through the mounted handler using the physical HR alert collection path', async () => {
    const db = createFakeDb({
      docs: {
        'orgs/test-tenant/members/user-1': {
          role: 'pm',
          projectId: 'p001',
          projectIds: ['p001'],
          portalProfile: { projectId: 'p001', projectIds: ['p001'] },
        },
        'orgs/test-tenant/projects/p001': {
          name: '알파 프로젝트',
          shortName: '알파',
          contractAmount: 3000000,
          managerId: 'user-1',
        },
        'orgs/test-tenant/payroll_schedules/p001': {
          projectId: 'p001',
          dayOfMonth: 25,
          timezone: 'Asia/Seoul',
        },
      },
      collections: {
        'orgs/test-tenant/projects': [
          {
            id: 'p001',
            data: {
              name: '알파 프로젝트',
              shortName: '알파',
              contractAmount: 3000000,
              managerId: 'user-1',
            },
          },
        ],
        'orgs/test-tenant/weekly_submission_status': [
          {
            id: 'p001-2026-04-w3',
            data: {
              projectId: 'p001',
              yearMonth: '2026-04',
              weekNo: 3,
              projectionEdited: true,
              projectionUpdated: true,
              expenseEdited: false,
              expenseUpdated: false,
              expenseReviewPendingCount: 0,
              projectionUpdatedAt: '2026-04-16T02:00:00.000Z',
            },
          },
        ],
        'orgs/test-tenant/payroll_runs': [],
        'orgs/test-tenant/transactions': [
          {
            id: 'tx-in',
            data: {
              projectId: 'p001',
              direction: 'IN',
              amounts: { bankAmount: 3000000 },
            },
          },
        ],
        'orgs/test-tenant/monthly_closes': [],
        'orgs/test-tenant/project_change_alerts': [
          {
            id: 'alert-1',
            data: {
              projectId: 'p001',
              employeeName: '보람',
              eventType: 'RESIGNATION',
              effectiveDate: '2026-04-20',
              acknowledged: false,
              createdAt: '2026-04-16T09:00:00.000Z',
            },
          },
          {
            id: 'alert-2',
            data: {
              projectId: 'p001',
              employeeName: '하모니',
              eventType: 'TRANSFER',
              effectiveDate: '2026-04-21',
              acknowledged: true,
              createdAt: '2026-04-16T08:00:00.000Z',
            },
          },
        ],
      },
    });
    const app = express();
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'test-tenant',
        actorId: 'user-1',
        actorRole: 'pm',
      };
      next();
    });
    mountPortalReadModelRoutes(app, { db });
    app.use((error, _req, res, _next) => {
      res.status(error?.statusCode || 500).json({
        error: error?.code || 'internal_error',
        message: error?.message || 'Unexpected error',
      });
    });

    const response = await request(app).get('/api/v1/portal/dashboard-summary');

    expect(response.status).toBe(200);
    expect(db.collectionReads).toContain('orgs/test-tenant/project_change_alerts');
    expect(response.body.notices.hrAlerts).toEqual({
      count: 1,
      items: [
        {
          id: 'alert-1',
          employeeName: '보람',
          eventType: 'RESIGNATION',
          effectiveDate: '2026-04-20',
          projectId: 'p001',
        },
      ],
      overflowCount: 0,
    });
  });

  it('serves dashboard summary for an explicit visible project without depending on member active project state', async () => {
    const db = createFakeDb({
      docs: {
        'orgs/test-tenant/members/user-1': {
          role: 'pm',
          projectId: 'p001',
          projectIds: ['p001', 'p002'],
          portalProfile: { projectId: 'p001', projectIds: ['p001', 'p002'] },
        },
        'orgs/test-tenant/projects/p002': {
          name: '베타 프로젝트',
          shortName: '베타',
          contractAmount: 1200000,
          managerId: 'user-2',
        },
      },
      collections: {
        'orgs/test-tenant/projects': [
          {
            id: 'p001',
            data: {
              name: '알파 프로젝트',
              shortName: '알파',
              contractAmount: 3000000,
              managerId: 'user-1',
            },
          },
          {
            id: 'p002',
            data: {
              name: '베타 프로젝트',
              shortName: '베타',
              contractAmount: 1200000,
              managerId: 'user-2',
            },
          },
        ],
        'orgs/test-tenant/weekly_submission_status': [
          {
            id: 'p002-2026-04-w3',
            data: {
              projectId: 'p002',
              yearMonth: '2026-04',
              weekNo: 3,
              projectionEdited: true,
              projectionUpdated: true,
              expenseEdited: true,
              expenseUpdated: true,
              expenseReviewPendingCount: 0,
              projectionUpdatedAt: '2026-04-16T02:00:00.000Z',
            },
          },
        ],
        'orgs/test-tenant/payroll_runs': [],
        'orgs/test-tenant/transactions': [],
        'orgs/test-tenant/monthly_closes': [],
        'orgs/test-tenant/project_change_alerts': [],
      },
    });
    const app = express();
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'test-tenant',
        actorId: 'user-1',
        actorRole: 'pm',
      };
      next();
    });
    mountPortalReadModelRoutes(app, { db });
    app.use((error, _req, res, _next) => {
      res.status(error?.statusCode || 500).json({
        error: error?.code || 'internal_error',
        message: error?.message || 'Unexpected error',
      });
    });

    const response = await request(app).get('/api/v1/portal/dashboard-summary?projectId=p002');

    expect(response.status).toBe(200);
    expect(response.body.project.id).toBe('p002');
  });

  it('uses the latest historical projectionUpdatedAt for the dashboard projection timestamp while keeping current-week rows scoped', async () => {
    const db = createFakeDb({
      docs: {
        'orgs/test-tenant/members/user-1': {
          role: 'pm',
          projectId: 'p001',
          projectIds: ['p001', 'p002'],
          portalProfile: { projectId: 'p001', projectIds: ['p001', 'p002'] },
        },
        'orgs/test-tenant/projects/p001': {
          name: '알파 프로젝트',
          shortName: '알파',
          contractAmount: 3000000,
          managerId: 'user-1',
        },
      },
      collections: {
        'orgs/test-tenant/projects': [
          {
            id: 'p001',
            data: {
              name: '알파 프로젝트',
              shortName: '알파',
              contractAmount: 3000000,
              managerId: 'user-1',
            },
          },
          {
            id: 'p002',
            data: {
              name: '베타 프로젝트',
              shortName: '베타',
              contractAmount: 1200000,
              managerId: 'user-2',
            },
          },
        ],
        'orgs/test-tenant/weekly_submission_status': [
          {
            id: 'p001-2026-04-w3',
            data: {
              projectId: 'p001',
              yearMonth: '2026-04',
              weekNo: 3,
              projectionEdited: true,
              projectionUpdated: true,
              projectionUpdatedAt: '2026-04-12T01:00:00.000Z',
              updatedAt: '2026-04-17T09:00:00.000Z',
            },
          },
          {
            id: 'p001-2026-04-w2',
            data: {
              projectId: 'p001',
              yearMonth: '2026-04',
              weekNo: 2,
              projectionEdited: true,
              projectionUpdated: true,
              projectionUpdatedAt: '2026-04-16T08:00:00.000Z',
              updatedAt: '2026-04-16T08:30:00.000Z',
            },
          },
          {
            id: 'p002-2026-04-w3',
            data: {
              projectId: 'p002',
              yearMonth: '2026-04',
              weekNo: 3,
              projectionEdited: true,
              projectionUpdated: true,
              projectionUpdatedAt: '2026-04-15T02:00:00.000Z',
            },
          },
        ],
        'orgs/test-tenant/payroll_runs': [],
        'orgs/test-tenant/transactions': [],
        'orgs/test-tenant/monthly_closes': [],
        'orgs/test-tenant/project_change_alerts': [],
      },
    });
    const app = express();
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'test-tenant',
        actorId: 'user-1',
        actorRole: 'pm',
      };
      next();
    });
    mountPortalReadModelRoutes(app, { db });
    app.use((error, _req, res, _next) => {
      res.status(error?.statusCode || 500).json({
        error: error?.code || 'internal_error',
        message: error?.message || 'Unexpected error',
      });
    });

    const response = await request(app).get('/api/v1/portal/dashboard-summary');

    expect(response.status).toBe(200);
    expect(response.body.surface.projection.latestUpdatedAt).toBe('2026-04-16T08:00:00.000Z');

    const weeklyStatusReads = db.queryReads.filter((entry) => entry.path === 'orgs/test-tenant/weekly_submission_status');
    expect(weeklyStatusReads).toHaveLength(2);
    expect(weeklyStatusReads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filters: [
          { field: 'yearMonth', op: '==', expectedValue: '2026-04' },
          { field: 'weekNo', op: '==', expectedValue: 3 },
        ],
      }),
      expect.objectContaining({
        filters: [
          { field: 'projectId', op: '==', expectedValue: 'p001' },
        ],
      }),
    ]));
  });

  it('rejects dashboard summary requests for projects outside the visible project set', async () => {
    const db = createFakeDb({
      docs: {
        'orgs/test-tenant/members/user-1': {
          role: 'pm',
          projectId: 'p001',
          projectIds: ['p001'],
          portalProfile: { projectId: 'p001', projectIds: ['p001'] },
        },
      },
      collections: {
        'orgs/test-tenant/projects': [
          {
            id: 'p001',
            data: {
              name: '알파 프로젝트',
              shortName: '알파',
              contractAmount: 3000000,
              managerId: 'user-1',
            },
          },
          {
            id: 'p002',
            data: {
              name: '베타 프로젝트',
              shortName: '베타',
              contractAmount: 1200000,
              managerId: 'user-2',
            },
          },
        ],
        'orgs/test-tenant/weekly_submission_status': [],
        'orgs/test-tenant/payroll_runs': [],
        'orgs/test-tenant/transactions': [],
        'orgs/test-tenant/monthly_closes': [],
        'orgs/test-tenant/project_change_alerts': [],
      },
    });
    const app = express();
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'test-tenant',
        actorId: 'user-1',
        actorRole: 'pm',
      };
      next();
    });
    mountPortalReadModelRoutes(app, { db });
    app.use((error, _req, res, _next) => {
      res.status(error?.statusCode || 500).json({
        error: error?.code || 'internal_error',
        message: error?.message || 'Unexpected error',
      });
    });

    const response = await request(app).get('/api/v1/portal/dashboard-summary?projectId=p002');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'project_forbidden',
    });
  });

  it('loads dashboard weekly submission status through one current-week constrained query instead of per-project history scans', async () => {
    const db = createFakeDb({
      docs: {
        'orgs/test-tenant/members/user-1': {
          role: 'pm',
          projectId: 'p001',
          projectIds: ['p001', 'p002'],
          portalProfile: { projectId: 'p001', projectIds: ['p001', 'p002'] },
        },
        'orgs/test-tenant/projects/p001': {
          name: '알파 프로젝트',
          shortName: '알파',
          contractAmount: 3000000,
          managerId: 'user-1',
        },
      },
      collections: {
        'orgs/test-tenant/projects': [
          {
            id: 'p001',
            data: {
              name: '알파 프로젝트',
              shortName: '알파',
              contractAmount: 3000000,
              managerId: 'user-1',
            },
          },
          {
            id: 'p002',
            data: {
              name: '베타 프로젝트',
              shortName: '베타',
              contractAmount: 1200000,
              managerId: 'user-2',
            },
          },
        ],
        'orgs/test-tenant/weekly_submission_status': [
          {
            id: 'p001-history',
            data: {
              projectId: 'p001',
              yearMonth: '2025-01',
              weekNo: 1,
              projectionEdited: true,
            },
          },
          {
            id: 'p002-history',
            data: {
              projectId: 'p002',
              yearMonth: '2025-01',
              weekNo: 1,
              projectionEdited: false,
            },
          },
        ],
        'orgs/test-tenant/payroll_runs': [],
        'orgs/test-tenant/transactions': [],
        'orgs/test-tenant/monthly_closes': [],
        'orgs/test-tenant/project_change_alerts': [],
      },
    });
    const app = express();
    app.use((req, _res, next) => {
      req.context = {
        tenantId: 'test-tenant',
        actorId: 'user-1',
        actorRole: 'pm',
      };
      next();
    });
    mountPortalReadModelRoutes(app, { db });
    app.use((error, _req, res, _next) => {
      res.status(error?.statusCode || 500).json({
        error: error?.code || 'internal_error',
        message: error?.message || 'Unexpected error',
      });
    });

    const response = await request(app).get('/api/v1/portal/dashboard-summary');

    expect(response.status).toBe(200);
    expect(response.body.submissionRows).toHaveLength(2);

    const weeklyStatusReads = db.queryReads.filter((entry) => entry.path === 'orgs/test-tenant/weekly_submission_status');
    expect(weeklyStatusReads).toHaveLength(2);
    expect(weeklyStatusReads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filters: [
          { field: 'yearMonth', op: '==', expectedValue: '2026-04' },
          { field: 'weekNo', op: '==', expectedValue: 3 },
        ],
      }),
      expect.objectContaining({
        filters: [
          { field: 'projectId', op: '==', expectedValue: 'p001' },
        ],
      }),
    ]));
  });
});
