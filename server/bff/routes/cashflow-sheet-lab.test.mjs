import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountCashflowSheetLabRoutes } from './cashflow-sheet-lab.mjs';
import { GoogleSheetsServiceError } from '../google-sheets.mjs';

const PROJECTION_IN_LABELS = [
  'MYSC 선입금 - 직접사업비 등',
  'MYSC 선입금 - MYSC 인건비',
  'MYSC 선입금 - 메입부가세',
  '매출액(입금)',
  '매출부가세(입금)',
  '팀지원금(입금)',
  '은행이자(입금)',
];

const PROJECTION_OUT_LABELS = [
  'MYSC 선입금 - 직접사업비 등',
  'MYSC 선입금 - MYSC 인건비',
  '직접사업비(공급가액)',
  '매입부가세',
  'MYSC인건비',
  'MYSC수익',
  '매출부가세(출금)',
  '팀지원금(출금)',
  '은행이자(출금)',
];

const ACTUAL_IN_LABELS = [
  'MYSC 선입금 - 직접사업비 등(입금)',
  'MYSC 선입금 - MYSC 인건비(입금)',
  'MYSC 선입금 - 매입부가세(입금)',
  ...PROJECTION_IN_LABELS.slice(3),
];

const ACTUAL_OUT_LABELS = [
  'MYSC 선입금 - 직접사업비 등(출금)',
  'MYSC 선입금 - MYSC 인건비(출금)',
  ...PROJECTION_OUT_LABELS.slice(2),
];

function buildSection(actual = false, weekLabels = ['26-1-1', '26-1-2', '26-1-3']) {
  const weekRow = ['', '', '', ...weekLabels];
  const valueCells = weekLabels.map(() => '999');
  const inLabels = actual ? ACTUAL_IN_LABELS : PROJECTION_IN_LABELS;
  const outLabels = actual ? ACTUAL_OUT_LABELS : PROJECTION_OUT_LABELS;
  return [
    [actual ? 'ACTUAL' : 'Projection'],
    weekRow,
    ...inLabels.map((label) => [label, '', '', ...valueCells]),
    ['입금 합계', '', '', ...valueCells],
    ...outLabels.map((label) => [label, '', '', ...valueCells]),
    ['출금 합계', '', '', ...valueCells],
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

function createDb({ project = { id: 'project-a' }, weeks = [], initialDocuments = {} } = {}) {
  const documents = new Map();
  documents.set('orgs/tenant-a/projects/project-a', { ...project });
  for (const week of weeks) {
    documents.set(`orgs/tenant-a/cashflow_weeks/${week.id}`, { ...week });
  }
  for (const [path, value] of Object.entries(initialDocuments)) {
    documents.set(path, { ...value });
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

  it('reads Google Sheets only on explicit mirror refresh and pins the result', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      spreadsheetTitle: 'Cashflow workbook',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });

    const beforeRefresh = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);
    expect(beforeRefresh.body).toMatchObject({ projectId: 'project-a', status: 'EMPTY' });
    expect(previewSpreadsheet).not.toHaveBeenCalled();

    const refreshed = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-refresh-001' })
      .expect(200);
    expect(refreshed.body).toMatchObject({
      projectId: 'project-a',
      status: 'FRESH',
      sourceRevision: expect.stringMatching(/^sha256:/),
      targetRevisionAtFetch: expect.stringMatching(/^sha256:/),
      summary: { cellCount: 32, valueCount: 32, emptyCount: 0, invalidCount: 0 },
    });
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);

    const pinned = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);
    expect(pinned.body.sourceRevision).toBe(refreshed.body.sourceRevision);
    expect(pinned.body.cells).toHaveLength(32);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(db.__getDocument().cashflowSheetLab.activeWeeks).toBeUndefined();
  });

  it('keeps the last-good mirror as STALE when an explicit refresh fails', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-1',
        },
      },
    });
    const previewSpreadsheet = vi.fn()
      .mockResolvedValueOnce({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })
      .mockRejectedValueOnce(new GoogleSheetsServiceError('temporary failure', {
        code: 'google_sheets_api_error',
        statusCode: 503,
      }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });

    const first = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-stale-first' })
      .expect(200);
    const second = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-stale-second' })
      .expect(200);

    expect(second.body).toMatchObject({
      status: 'STALE',
      sourceRevision: first.body.sourceRevision,
      lastRefreshError: { code: 'google_sheets_api_error' },
    });
    expect(second.body.cells).toEqual(first.body.cells);
  });

  it('returns ERROR when the first explicit mirror refresh fails', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: { value: 'spreadsheet-a', sheetName: 'cashflow(사용내역 연동)' },
      },
    });
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => {
          throw new GoogleSheetsServiceError('unavailable', {
            code: 'google_sheets_api_error',
            statusCode: 503,
          });
        }),
      },
    });

    const response = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-error-first' })
      .expect(200);
    expect(response.body).toMatchObject({
      projectId: 'project-a',
      status: 'ERROR',
      lastRefreshError: { code: 'google_sheets_api_error' },
    });
    expect(response.body.sourceRevision).toBeUndefined();
  });

  it('replays an explicit mirror refresh idempotently without rereading Google', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: { value: 'spreadsheet-a', sheetName: 'cashflow(사용내역 연동)' },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });
    const payload = { idempotencyKey: 'mirror-idempotent-001' };

    const first = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send(payload)
      .expect(200);
    const replay = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send(payload)
      .expect(200);

    expect(replay.body.sourceRevision).toBe(first.body.sourceRevision);
    expect(replay.body.capturedAt).toBe(first.body.capturedAt);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
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

  it('does not contact Google while reading saved config', async () => {
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

    expect(response.body.config.spreadsheetTitle).toBe('');
    expect(getSpreadsheetMeta).not.toHaveBeenCalled();
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

  it('rejects direct final apply without a pinned stage run', async () => {
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

    await request(createApp({
      db,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
        'x-edit-finalize': 'true',
      })
      .send({ idempotencyKey: 'apply-jvm-001' })
      .expect(400)
      .expect((response) => expect(response.body.code).toBe('cashflow_sheet_stage_run_required'));

    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toBeUndefined();
  });

  it.each(['0', '-1', '01', '1e2', '1.0', '9007199254740992'])(
    'rejects non-canonical final-apply edit fence %s before the JVM',
    async (fence) => {
      const javaWeeklyClient = { applyCashflowSheetLab: vi.fn() };
      await request(createApp({
        routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
      }))
        .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
        .set({
          'x-edit-session-id': 'session-a',
          'x-edit-lease-id': 'lease-a',
          'x-edit-fence': fence,
        })
        .send({ idempotencyKey: `bad-fence-${fence}` })
        .expect(400)
        .expect((response) => {
          expect(response.body.code).toBe('cashflow_edit_lease_request_invalid');
        });
      expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
    },
  );

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

    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      spreadsheetTitle: 'Cashflow workbook',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-stage-001' })
      .expect(200);

    const response = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({
        expectedMirrorRevision: mirror.body.sourceRevision,
        idempotencyKey: 'stage-001',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      commandName: 'cashflowSheetLab.stage.firebase',
      stagedLineCount: 32,
      projectionLineCount: 16,
      actualLineCount: 16,
    });
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
    const candidates = db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/');
    expect(candidates).toHaveLength(32);
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
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(db.__getDocument().cashflowSheetLab.activeWeeks).toBeUndefined();
  });

  it('rejects stage when the pinned source revision does not match', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: { value: 'saved-spreadsheet-a', sheetName: 'cashflow(사용내역 연동)' },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-wrong-revision' })
      .expect(200);

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: 'sha256:wrong', idempotencyKey: 'stage-wrong-revision' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_mirror_revision_conflict');
      });
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(0);
  });

  it('replays stage idempotently without duplicating candidates', async () => {
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
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-stage-replay' })
      .expect(200);
    const payload = {
      expectedMirrorRevision: mirror.body.sourceRevision,
      idempotencyKey: 'stage-replay-001',
    };

    const first = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send(payload)
      .expect(200);
    const replay = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send(payload)
      .expect(200);

    expect(replay.body.runId).toBe(first.body.runId);
    expect(replay.body.lastStagedAt).toBe(first.body.lastStagedAt);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(32);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_runs/')).toHaveLength(1);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it('blocks only a month containing an invalid pinned cell', async () => {
    const matrix = buildMatrix();
    matrix[3][3] = '확인 필요';
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
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix,
        })),
      },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-invalid-month' })
      .expect(200);
    expect(mirror.body.summary.invalidCount).toBe(1);

    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-invalid-month' })
      .expect(200);
    expect(stage.body).toMatchObject({
      status: 'BLOCKED',
      stagedLineCount: 0,
      blockedMonths: ['2026-01'],
    });
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(0);
  });

  it('preserves an EMPTY pinned cell as an authoritative removal candidate', async () => {
    const matrix = buildMatrix();
    matrix[3][3] = '-';
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
      }],
    });
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix,
        })),
      },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-empty-cell' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-empty-cell' })
      .expect(200);
    const removal = stage.body.candidates.find((candidate) => (
      candidate.mode === 'projection' && candidate.lineId === 'MYSC_PREPAY_IN'
    ));
    expect(removal).toMatchObject({
      beforeHadValue: true,
      beforeAmount: 100,
      proposedHadValue: false,
      proposedAmount: null,
      cellState: 'EMPTY',
    });
  });

  it('rejects stage when canonical cashflow changed after the explicit refresh', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: { value: 'saved-spreadsheet-a', sheetName: 'cashflow(사용내역 연동)' },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrix(),
    }));
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-target-drift' })
      .expect(200);
    await db.doc('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1').set({
      id: 'project-a-2026-01-w1',
      projectId: 'project-a',
      yearMonth: '2026-01',
      weekNo: 1,
      projection: { SALES_IN: 1 },
    });

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-target-drift' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_target_revision_conflict');
      });
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
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

    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-stage-apply-001' })
      .expect(200);

    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({
        expectedMirrorRevision: mirror.body.sourceRevision,
        idempotencyKey: 'stage-apply-001',
      })
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
    const replay = await request(app)
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
      appliedLineCount: 32,
      projectionLineCount: 16,
      actualLineCount: 16,
      skippedRiskLineCount: 0,
      stagedRunId: stage.body.runId,
    });
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(1);
    expect(replay.body).toEqual(apply.body);
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
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

    const app = createApp({
      db,
      googleSheetsService,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-fixed-weeks' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-fixed-weeks' })
      .expect(200);
    const response = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-002' })
      .expect(200);

    expect(response.body).toMatchObject({
      appliedLineCount: 64,
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
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 16, responses: [] }));
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
      updatedCellCount: 16,
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
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 16, responses: [] }));
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
    const batchUpdateValues = vi.fn(async () => ({ totalUpdatedCells: 16, responses: [] }));
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
