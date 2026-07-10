import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountCashflowSheetLabRoutes, runCashflowSheetLabSyncWorker } from './cashflow-sheet-lab.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';

const IN_LABELS = [
  'MYSC 선입금(잔금 등 입금 필요 시)',
  '매출액(입금)',
  '매출부가세(입금)',
  '팀지원금(입금)',
  '은행이자(입금)',
];

const OUT_LABELS = [
  '직접사업비(공급가액)',
  '매입부가세',
  'MYSC인건비',
  'MYSC수익(간접비등)',
  '매출부가세(출금)',
  '팀지원금(출금)',
  '은행이자(출금)',
];

function buildSection(actual = false, weekLabels = ['26-1-1', '26-1-2', '26-1-3']) {
  const weekRow = ['', '', '', ...weekLabels];
  const valueCells = weekLabels.map(() => '999');
  return [
    [actual ? 'ACTUAL' : 'Projection'],
    weekRow,
    ...IN_LABELS.map((label) => [label, '', '', ...valueCells]),
    ['입금 합계', '', '', ...valueCells],
    ...OUT_LABELS.map((label) => [label, '', '', ...valueCells]),
    [actual ? '잔액' : '잔액 (※ 중요)', '', '', ...valueCells],
  ];
}

function buildMatrix() {
  return [
    ['title'],
    ...buildSection(false),
    [],
    ...buildSection(true),
  ];
}

function buildMatrixWithWeekLabels(weekLabels) {
  return [
    ['title'],
    ...buildSection(false, weekLabels),
    [],
    ...buildSection(true, weekLabels),
  ];
}

function createDb({ project = { id: 'project-a' }, weeks = [] } = {}) {
  const documents = new Map();
  documents.set('orgs/tenant-a/projects/project-a', { ...project });
  for (const week of weeks) {
    documents.set(`orgs/tenant-a/cashflow_weeks/${week.id}`, { ...week });
  }

  function ref(path) {
    return {
      path,
      get: vi.fn(async () => ({
        exists: documents.has(path),
        data: () => documents.get(path),
      })),
      set: vi.fn(async (patch, options = {}) => {
        documents.set(path, options.merge ? { ...(documents.get(path) || {}), ...patch } : { ...patch });
      }),
    };
  }

  return {
    doc: vi.fn(ref),
    collection: vi.fn((path) => ({
      get: vi.fn(async () => ({
        docs: [...documents.entries()]
          .filter(([docPath]) => docPath.startsWith(`${path}/`))
          .map(([docPath, data]) => ({
            id: docPath.slice(path.length + 1),
            data: () => data,
          })),
      })),
      where: vi.fn((_field, _op, value) => ({
        get: vi.fn(async () => ({
          docs: [...documents.entries()]
            .filter(([docPath, data]) => docPath.startsWith(`${path}/`) && data.projectId === value)
            .map(([docPath, data]) => ({
              id: docPath.slice(path.length + 1),
              data: () => data,
            })),
        })),
      })),
    })),
    runTransaction: vi.fn(async (callback) => callback({
      get: (docRef) => docRef.get(),
      set: (docRef, patch, options) => docRef.set(patch, options),
    })),
    __getDocument: (path = 'orgs/tenant-a/projects/project-a') => documents.get(path),
    __getDocumentsByPrefix: (prefix) => [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ path, data })),
  };
}

function createApp({ context = {}, db = createDb(), googleSheetsService, routeOptions = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'actor-a',
      actorRole: 'workspace_user',
      actorEmail: 'user@mysc.co.kr',
      requestId: 'req-1',
      ...context,
    };
    next();
  });
  mountCashflowSheetLabRoutes(app, {
    db,
    googleSheetsService: googleSheetsService || {
      getServiceAccountEmail: () => 'cashflow-service@mysc.iam.gserviceaccount.com',
      getSpreadsheetMeta: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      })),
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })),
    },
    ...routeOptions,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      code: error.code || 'error',
      message: error.message,
    });
  });
  return app;
}

function createDisabledApp() {
  const app = express();
  app.use(express.json());
  mountCashflowSheetLabRoutes(app, {
    enabled: false,
    db: createDb(),
    googleSheetsService: {
      previewSpreadsheet: vi.fn(),
    },
  });
  return app;
}

describe('cashflow sheet lab route', () => {
  it('returns 404 when the deployment surface disables sheet lab', async () => {
    await request(createDisabledApp())
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .expect(404)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_lab_not_available');
      });
  });

  it('saves the cashflow sheet config without reading Google Sheets', async () => {
    const db = createDb();
    const previewSpreadsheet = vi.fn();

    const response = await request(createApp({ db, googleSheetsService: { previewSpreadsheet } }))
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-3',
      })
      .expect(200);

    expect(response.body.config).toMatchObject({
      value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1',
      sheetName: 'cashflow(사용내역 연동)',
      spreadsheetId: 'spreadsheet-a',
      weekBasis: 'sheet_range',
      totalBasis: 'sheet_range',
      updatedBy: { email: 'user@mysc.co.kr', role: 'workspace_user' },
    });
    expect(previewSpreadsheet).not.toHaveBeenCalled();
    expect(db.__getDocument().cashflowSheetLab).toMatchObject(response.body.config);
  });

  it('returns the system service account email with the saved config', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .expect(200);

    expect(response.body.systemAccountEmail).toBe('cashflow-service@mysc.iam.gserviceaccount.com');
    expect(response.body.accessPolicy).toMatchObject({
      googleAuth: 'service_account',
      serviceAccountEmail: 'cashflow-service@mysc.iam.gserviceaccount.com',
      sheetPermission: 'shared_with_mysc_system_account',
    });
  });

  it('hydrates missing saved config spreadsheet title from Google Sheets metadata', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1',
          sheetName: 'cashflow(사용내역 연동)',
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: '',
          startWeek: '26-1-1',
          endWeek: '26-1-3',
        },
      },
    });
    const getSpreadsheetMeta = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      spreadsheetTitle: '[AXR]사업비 관리 시트',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
    }));

    const response = await request(createApp({
      db,
      googleSheetsService: {
        getServiceAccountEmail: () => 'cashflow-service@mysc.iam.gserviceaccount.com',
        getSpreadsheetMeta,
        previewSpreadsheet: vi.fn(),
      },
    }))
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .expect(200);

    expect(response.body.config.spreadsheetTitle).toBe('[AXR]사업비 관리 시트');
    expect(getSpreadsheetMeta).toHaveBeenCalledWith('spreadsheet-a');
  });

  it('allows saving ranges before sheet headers are verified', async () => {
    await request(createApp())
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'spreadsheet-a',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-4',
      })
      .expect(200);
  });

  it('rejects preview ranges that are not present in the sheet headers', async () => {
    await request(createApp())
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({
        value: 'spreadsheet-a',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-4',
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_week_range_not_in_sheet');
      });
  });

  it('previews current values from Firebase cashflow_weeks', async () => {
    const db = createDb({
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { SALES_IN: 123 },
        actual: { SALES_IN: 456 },
      }],
    });

    const response = await request(createApp({ db }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(response.body.accessPolicy.valueSource).toBe('firebase_cashflow_weeks');
    expect(response.body.previewValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'projection', lineId: 'SALES_IN', amount: 123, source: 'firebase_cashflow_weeks' }),
      expect.objectContaining({ mode: 'actual', lineId: 'SALES_IN', amount: 456, source: 'firebase_cashflow_weeks' }),
    ]));
  });

  it('ignores deprecated Google access tokens for sheet reads', async () => {
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      spreadsheetTitle: 'Cashflow workbook',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [],
      matrix: buildMatrix(),
    }));

    const response = await request(createApp({ googleSheetsService: { previewSpreadsheet } }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .set('x-google-access-token', 'google-token')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(previewSpreadsheet).toHaveBeenCalledWith(expect.not.objectContaining({ accessToken: expect.any(String) }));
    expect(response.body.accessPolicy.googleAuth).toBe('service_account');
  });

  it('normalizes service account sheet permission failures', async () => {
    const previewSpreadsheet = vi.fn(async () => {
      throw new GoogleSheetsServiceError('Google Sheets API request failed', {
        code: 'google_sheets_api_error',
        statusCode: 403,
      });
    });

    await request(createApp({ googleSheetsService: { previewSpreadsheet } }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .set('x-google-access-token', 'expired-or-forbidden-token')
      .send({ value: 'spreadsheet-a' })
      .expect(403)
      .expect((response) => {
        expect(response.body.code).toBe('google_sheet_service_account_forbidden');
        expect(response.body.message).toContain('시스템 서비스 계정');
      });

    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(previewSpreadsheet).toHaveBeenCalledWith(expect.not.objectContaining({ accessToken: expect.any(String) }));
  });

  it('fails closed instead of using the legacy Node multi-transaction apply path', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });

    await request(createApp({ db }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-001' })
      .expect(503)
      .expect((response) => expect(response.body.code).toBe('cashflow_edit_leases_disabled'));
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toBeUndefined();
  });

  it('routes Stage final apply through JVM with the edit lease and performs no Node canonical write', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
    });
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, lines }) => ({
        ok: true,
        projectId,
        sourceSheetKey: 'cashflow-sheet-lab',
        savedProjectionLineCount: lines.filter((line) => line.mode === 'projection').length,
        savedActualLineCount: lines.filter((line) => line.mode === 'actual').length,
      })),
    };

    const response = await request(createApp({
      db,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ idempotencyKey: 'apply-jvm-001' })
      .expect(200);

    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a',
      idempotencyKey: 'apply-jvm-001',
      editSession: { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 },
      lines: expect.arrayContaining([
        expect.objectContaining({ mode: 'projection', cashflowLine: 'MYSC_PREPAY_IN', amount: 999 }),
        expect.objectContaining({ mode: 'actual', cashflowLine: 'MYSC_PREPAY_IN', amount: 999 }),
      ]),
    }));
    expect(response.body.firebaseResult.commandName).toBe('weeklyExpense.cashflowSheetLab.apply');
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toBeUndefined();
  });

  it('stages sheet values as cell-level review candidates without updating cashflow weeks', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 100 },
        actual: { MYSC_PREPAY_IN: 200 },
      }],
    });

    const response = await request(createApp({ db }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ idempotencyKey: 'stage-001' })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      commandName: 'cashflowSheetLab.stage.firebase',
      stagedLineCount: 24,
      projectionLineCount: 12,
      actualLineCount: 12,
    });
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
    const candidates = db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/');
    expect(candidates).toHaveLength(24);
    expect(candidates.find((candidate) => candidate.data.mode === 'projection' && candidate.data.lineId === 'MYSC_PREPAY_IN')?.data).toMatchObject({
      projectId: 'project-a',
      status: 'pending_review',
      source: 'google_sheet',
      lineDirection: 'in',
      beforeAmount: 100,
      beforeHadValue: true,
      proposedAmount: 999,
      proposedHadValue: true,
      sourceCell: expect.any(String),
    });
    expect(candidates.find((candidate) => candidate.data.mode === 'actual' && candidate.data.lineId === 'MYSC_PREPAY_IN')?.data.riskFlags).toEqual([]);
  });

  it('applies a staged candidate run through JVM without rereading the Google Sheet', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 100 },
        actual: { MYSC_PREPAY_IN: 200 },
      }],
    });
    let previewCalls = 0;
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => {
        previewCalls += 1;
        if (previewCalls > 1) throw new Error('apply must use staged candidates');
        return {
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: 'Cashflow workbook',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrix(),
        };
      }),
    };
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, lines }) => ({
        ok: true,
        projectId,
        commandName: 'weeklyExpense.cashflowSheetLab.apply',
        savedProjectionLineCount: lines.filter((line) => line.mode === 'projection').length,
        savedActualLineCount: lines.filter((line) => line.mode === 'actual').length,
      })),
    };
    const app = createApp({
      db,
      googleSheetsService,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });

    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ idempotencyKey: 'stage-apply-001' })
      .expect(200);

    const apply = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-stage-001' })
      .expect(200);

    expect(googleSheetsService.previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(apply.body).toMatchObject({
      appliedLineCount: 24,
      projectionLineCount: 12,
      actualLineCount: 12,
      skippedRiskLineCount: 0,
      stagedRunId: stage.body.runId,
    });
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(1);
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
  });

  it('disables the automatic sync worker because it has no interactive edit lease', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
    });

    await expect(runCashflowSheetLabSyncWorker({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: 'Cashflow workbook',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrix(),
        })),
      },
      tenantIds: ['tenant-a'],
      limit: 10,
      nowIso: '2026-06-16T09:00:00.000Z',
      editLeasesEnabled: true,
    })).rejects.toMatchObject({ statusCode: 503, code: 'cashflow_sync_requires_edit_lease' });
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toBeUndefined();
  });

  it('applies fixed-sheet week labels through canonical finance weeks', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-2-4',
          endWeek: '26-2-5',
        },
      },
    });
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrixWithWeekLabels(['26-2-4', '26-2-5']),
      })),
    };
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, lines }) => ({
        ok: true,
        projectId,
        savedProjectionLineCount: lines.filter((line) => line.mode === 'projection').length,
        savedActualLineCount: lines.filter((line) => line.mode === 'actual').length,
      })),
    };

    const response = await request(createApp({
      db,
      googleSheetsService,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ idempotencyKey: 'apply-002' })
      .expect(200);

    expect(response.body).toMatchObject({
      appliedLineCount: 48,
      skippedInvalidWeekCount: 0,
      skippedInvalidWeeks: [],
    });
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ yearMonth: '2026-02', weekNo: 4 }),
        expect.objectContaining({ yearMonth: '2026-02', weekNo: 5 }),
      ]),
    }));
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-02-w4')).toBeUndefined();
  });

  it('previews Projection to Google Sheet write-back without including Actual writes', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 123 },
        actual: { MYSC_PREPAY_IN: 456 },
      }],
    });

    const response = await request(createApp({ db }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/preview')
      .send({})
      .expect(200);

    expect(response.body.accessPolicy.writePolicy).toBe('projection_only');
    expect(response.body.plan.hasChanges).toBe(true);
    expect(response.body.plan.changedCells).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: 'projection',
        lineId: 'MYSC_PREPAY_IN',
        sheetAmount: 999,
        platformAmount: 123,
      }),
    ]));
    expect(response.body.plan.changedCells.some((cell) => cell.mode === 'actual')).toBe(false);
  });

  it('writes platform Projection values back to Google Sheet and records a sync job', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 123 },
        actual: { MYSC_PREPAY_IN: 456 },
      }],
    });
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 12, responses: [] }));
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })),
      batchUpdateValues,
    };

    const previewResponse = await request(createApp({ db, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/preview')
      .send({})
      .expect(200);
    const response = await request(createApp({ db, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/apply')
      .send({
        baselineHash: previewResponse.body.plan.baselineHash,
        idempotencyKey: 'writeback-001',
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(batchUpdateValues).toHaveBeenCalledWith(expect.objectContaining({
      spreadsheetId: 'spreadsheet-a',
      sheetName: 'cashflow(사용내역 연동)',
      updates: expect.arrayContaining([
        expect.objectContaining({ rangeA1: 'D4', value: 123 }),
      ]),
    }));
    expect(db.__getDocument('orgs/tenant-a/cashflow_projection_sync_jobs/writeback-001')).toMatchObject({
      status: 'DONE',
      projectId: 'project-a',
      changeCount: expect.any(Number),
      updatedCellCount: 12,
    });
    expect(db.__getDocument('outbox/writeback-001')).toMatchObject({
      eventType: 'cashflow.projection_sheet_writeback.done',
      entityType: 'cashflow_projection_sync_job',
      status: 'PENDING',
    });
  });

  it('ignores deprecated Google access tokens for Projection write-back', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 123 },
        actual: { MYSC_PREPAY_IN: 456 },
      }],
    });
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 12, responses: [] }));
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })),
      batchUpdateValues,
    };

    const previewResponse = await request(createApp({ db, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/preview')
      .set('x-google-access-token', 'google-token')
      .send({})
      .expect(200);
    const response = await request(createApp({ db, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/apply')
      .set('x-google-access-token', 'google-token')
      .send({
        baselineHash: previewResponse.body.plan.baselineHash,
        idempotencyKey: 'writeback-fallback-001',
      })
      .expect(200);

    expect(batchUpdateValues).toHaveBeenCalledTimes(1);
    expect(batchUpdateValues).toHaveBeenCalledWith(expect.not.objectContaining({ accessToken: expect.any(String) }));
    expect(response.body.accessPolicy.googleAuth).toBe('service_account');
    expect(response.body.accessPolicy.sheetPermission).toBe('shared_with_mysc_system_account');
    expect(response.body.ok).toBe(true);
  });

  it('blocks Projection write-back when the sheet changed after preview', async () => {
    const changedMatrix = buildMatrix();
    changedMatrix[3][3] = '1,111';
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        projection: { MYSC_PREPAY_IN: 123 },
      }],
    });
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 12, responses: [] }));
    const googleSheetsService = {
      previewSpreadsheet: vi
        .fn()
        .mockResolvedValueOnce({
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: 'Cashflow workbook',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrix(),
        })
        .mockResolvedValueOnce({
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: 'Cashflow workbook',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: changedMatrix,
        }),
      batchUpdateValues,
    };
    const app = createApp({ db, googleSheetsService });

    const previewResponse = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/preview')
      .send({})
      .expect(200);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/writeback/apply')
      .send({
        baselineHash: previewResponse.body.plan.baselineHash,
        idempotencyKey: 'writeback-conflict-001',
      })
      .expect(409)
      .expect((response) => {
        expect(response.body.code || response.body.error).toBe('cashflow_projection_sheet_conflict');
      });

    expect(batchUpdateValues).not.toHaveBeenCalled();
    expect(db.__getDocument('orgs/tenant-a/cashflow_projection_sync_jobs/writeback-conflict-001')).toMatchObject({
      status: 'CONFLICT',
      projectId: 'project-a',
      conflict: expect.objectContaining({ reason: 'sheet_changed_after_preview' }),
    });
  });

  it('denies external emails', async () => {
    await request(createApp({
      context: {
        actorEmail: 'external@example.com',
      },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(403);
  });

  it('allows admins outside the workspace domain', async () => {
    await request(createApp({
      context: {
        actorRole: 'admin',
        actorEmail: 'admin@example.com',
      },
    }))
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .expect(200);
  });
});
