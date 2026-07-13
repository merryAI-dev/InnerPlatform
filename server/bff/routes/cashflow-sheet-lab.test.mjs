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

const JANUARY_FINANCE_WEEKS = ['26-1-1', '26-1-2', '26-1-3', '26-1-4', '26-1-5'];

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

function createDb({ project = { id: 'project-a' }, weeks = [], initialDocuments = {}, onGet, onQuery } = {}) {
  const documents = new Map();
  const queries = [];
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
      get: vi.fn(async () => {
        if (onGet) await onGet(path);
        return {
          exists: documents.has(path),
          data: () => documents.get(path),
        };
      }),
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
      where: vi.fn((field, op, value) => {
        queries.push({ path, field, op, value });
        return {
          get: vi.fn(async () => {
            if (onQuery) await onQuery({ path, field, op, value });
            return {
              docs: [...documents.entries()]
              .filter(([docPath, data]) => docPath.startsWith(`${path}/`) && data[field] === value)
              .map(([docPath, data]) => ({
                id: docPath.slice(path.length + 1),
                data: () => data,
              })),
            };
          }),
        };
      }),
    })),
    runTransaction: vi.fn(async (callback) => callback({
      get: (docRef) => docRef.get(),
      set: (docRef, patch, options) => docRef.set(patch, options),
    })),
    __getDocument: (path = 'orgs/tenant-a/projects/project-a') => documents.get(path),
    __getDocumentsByPrefix: (prefix) => [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, data]) => ({ path, data })),
    __getQueries: () => [...queries],
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

  it('replays an older refresh key without rereading Google or replacing the latest pinned mirror', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: { value: 'spreadsheet-a', sheetName: 'cashflow(사용내역 연동)' },
      },
    });
    const previewSpreadsheet = vi.fn(async () => {
      const matrix = buildMatrix();
      matrix[3][3] = previewSpreadsheet.mock.calls.length === 1 ? '111' : '222';
      return {
        spreadsheetId: 'spreadsheet-a',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix,
      };
    });
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });

    const first = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-old-key-a' })
      .expect(200);
    const second = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-new-key-b' })
      .expect(200);
    const firstReplay = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-old-key-a' })
      .expect(200);
    const pinned = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);

    expect(first.body.sourceRevision).not.toBe(second.body.sourceRevision);
    expect(firstReplay.body.sourceRevision).toBe(first.body.sourceRevision);
    expect(firstReplay.body.cells).toEqual(first.body.cells);
    expect(pinned.body.sourceRevision).toBe(second.body.sourceRevision);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest explicit refresh pinned when an older request finishes later', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    let releaseFirstPreview;
    let markFirstPreviewStarted;
    const firstPreviewStarted = new Promise((resolve) => {
      markFirstPreviewStarted = resolve;
    });
    const firstPreviewGate = new Promise((resolve) => {
      releaseFirstPreview = resolve;
    });
    const previewSpreadsheet = vi.fn(async () => {
      const callNumber = previewSpreadsheet.mock.calls.length;
      const matrix = buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS);
      matrix[3][3] = callNumber === 1 ? '111' : '222';
      if (callNumber === 1) {
        markFirstPreviewStarted();
        await firstPreviewGate;
      }
      return {
        spreadsheetId: callNumber === 1 ? 'spreadsheet-a' : 'spreadsheet-b',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix,
      };
    });
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });

    const olderRequest = request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-concurrent-older' })
      .then((response) => response);
    await firstPreviewStarted;
    await request(app)
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'spreadsheet-b',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-5',
      })
      .expect(200);
    const newerResponse = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-concurrent-newer' })
      .expect(200);
    releaseFirstPreview();
    const olderResponse = await olderRequest;
    const pinned = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);

    expect(olderResponse.status).toBe(200);
    expect(olderResponse.body.sourceRevision).toBe(newerResponse.body.sourceRevision);
    expect(pinned.body.sourceRevision).toBe(newerResponse.body.sourceRevision);
    expect(pinned.body.cells.find((cell) => cell.sourceCell === 'D4')?.amount).toBe(222);
  });

  it('does not install the first in-flight refresh after the saved config changes', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    let releasePreview;
    let markPreviewStarted;
    const previewStarted = new Promise((resolve) => {
      markPreviewStarted = resolve;
    });
    const previewGate = new Promise((resolve) => {
      releasePreview = resolve;
    });
    const previewSpreadsheet = vi.fn(async () => {
      markPreviewStarted();
      await previewGate;
      return {
        spreadsheetId: 'spreadsheet-a',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
      };
    });
    const app = createApp({ db, googleSheetsService: { previewSpreadsheet } });

    const inFlightRefresh = request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-first-in-flight' })
      .then((response) => response);
    await previewStarted;
    await request(app)
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'spreadsheet-b',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-5',
      })
      .expect(200);
    releasePreview();

    const completedRefresh = await inFlightRefresh;
    const pinned = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);

    expect(completedRefresh.status).toBe(200);
    expect(completedRefresh.body.status).not.toBe('FRESH');
    expect(pinned.body.status).not.toBe('FRESH');
    expect(pinned.body.sourceRevision).toBeUndefined();
  });

  it('rejects reuse of an older refresh key with a different source request', async () => {
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

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-reused-old-key' })
      .expect(200);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-next-key' })
      .expect(200);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'mirror-reused-old-key', value: 'spreadsheet-b' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('idempotency_key_reused');
      });

    expect(previewSpreadsheet).toHaveBeenCalledTimes(2);
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

  it('invalidates the pinned mirror and staged run when the saved sheet config changes', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    const javaWeeklyClient = { applyCashflowSheetLab: vi.fn() };
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
        })),
      },
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-before-config-change' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-before-config-change' })
      .expect(200);

    await request(app)
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'spreadsheet-b',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-5',
      })
      .expect(200);
    const staleMirror = await request(app)
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/mirror')
      .expect(200);

    expect(staleMirror.body).toMatchObject({
      status: 'STALE',
      sourceRevision: mirror.body.sourceRevision,
      lastRefreshError: { code: 'cashflow_sheet_config_changed' },
    });
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-after-config-change' })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_sheet_config_changed'));
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-before-config-change' })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_sheet_config_changed'));
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-after-config-change' })
      .expect(409)
      .expect((response) => expect(response.body.code).toBe('cashflow_sheet_config_changed'));
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
  });

  it('pins and applies an explicit owner-draft source even when the shared project config is older', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    const resultingTargetRevision = `sha256:${'5'.repeat(64)}`;
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, yearMonth, sourceRevision, targetRevision }) => ({
        ok: true,
        projectId,
        yearMonth,
        sourceRevision,
        targetRevision,
        resultingTargetRevision,
      })),
    };
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-b',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
        })),
      },
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({
        value: 'spreadsheet-b',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-5',
        idempotencyKey: 'refresh-owner-draft-b',
      })
      .expect(200);
    expect(mirror.body).toMatchObject({ status: 'FRESH', spreadsheetId: 'spreadsheet-b' });
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-owner-draft-b' })
      .expect(200);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-owner-draft-b' })
      .expect(200);

    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(1);
  });

  it('does not reserve an old staged apply when config changes during the final preflight', async () => {
    let gateTargetQuery = false;
    let markTargetQuery;
    let releaseTargetQuery;
    const targetQueryStarted = new Promise((resolve) => {
      markTargetQuery = resolve;
    });
    const targetQueryGate = new Promise((resolve) => {
      releaseTargetQuery = resolve;
    });
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
      onQuery: async ({ path }) => {
        if (!gateTargetQuery || !path.endsWith('/cashflow_weeks')) return;
        gateTargetQuery = false;
        markTargetQuery();
        await targetQueryGate;
      },
    });
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async () => ({
        ok: true,
        projectId: 'project-a',
        yearMonth: '2026-01',
        resultingTargetRevision: `sha256:${'6'.repeat(64)}`,
      })),
    };
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
        })),
      },
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-config-race' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-config-race' })
      .expect(200);

    gateTargetQuery = true;
    const applyRequest = request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-config-race' })
      .then((response) => response);
    await targetQueryStarted;
    await request(app)
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'spreadsheet-b',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-5',
      })
      .expect(200);
    releaseTargetQuery();
    const applyResponse = await applyRequest;

    expect(applyResponse.status).toBe(409);
    expect(applyResponse.body.code).toBe('cashflow_sheet_config_changed');
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
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

  it('retires direct live preview so only explicit pinned refresh can read Google', async () => {
    const previewSpreadsheet = vi.fn();

    await request(createApp({ googleSheetsService: { previewSpreadsheet } }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(410)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_direct_preview_retired');
      });

    expect(previewSpreadsheet).not.toHaveBeenCalled();
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
          endWeek: '26-1-5',
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
      matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
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
      stagedLineCount: 160,
      projectionLineCount: 80,
      actualLineCount: 80,
    });
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
    const candidates = db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/');
    expect(candidates).toHaveLength(160);
    const stagedMonths = db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_months/');
    expect(stagedMonths).toHaveLength(1);
    expect(stagedMonths[0].data).toMatchObject({
      projectId: 'project-a',
      yearMonth: '2026-01',
      sourceRevision: mirror.body.sourceRevision,
    });
    expect(stagedMonths[0].data.cells).toHaveLength(160);
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
          endWeek: '26-1-5',
        },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
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
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(160);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_runs/')).toHaveLength(1);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_months/')).toHaveLength(1);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it('uses deterministic candidate identities when the same stage request overlaps', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
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
          matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
        })),
      },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-stage-overlap' })
      .expect(200);
    const payload = {
      expectedMirrorRevision: mirror.body.sourceRevision,
      idempotencyKey: 'stage-overlap-001',
    };
    let tick = 0;
    const toISOString = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => (
      `2026-07-13T00:00:00.${String(tick++).padStart(3, '0')}Z`
    ));

    try {
      const responses = await Promise.all([
        request(app).post('/api/v1/projects/project-a/cashflow-sheet-lab/stage').send(payload),
        request(app).post('/api/v1/projects/project-a/cashflow-sheet-lab/stage').send(payload),
      ]);
      expect(responses.every((response) => [200, 409].includes(response.status))).toBe(true);
    } finally {
      toISOString.mockRestore();
    }

    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(160);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_runs/')).toHaveLength(1);
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
    const matrix = buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS);
    matrix[3][3] = '-';
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
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

  it('compares Actual against the cashflow-sheet-lab source contribution instead of the aggregate', async () => {
    const matrix = buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS);
    matrix[28][3] = '600';
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        actual: { SALES_IN: 600 },
        weeklyExpenseActualBySheet: {
          bank: { SALES_IN: 500 },
          'cashflow-sheet-lab': { SALES_IN: 100 },
        },
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
      .send({ idempotencyKey: 'refresh-source-specific-actual' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-source-specific-actual' })
      .expect(200);

    expect(stage.body.candidates).toContainEqual(expect.objectContaining({
      mode: 'actual',
      yearMonth: '2026-01',
      weekNo: 1,
      lineId: 'SALES_IN',
      beforeHadValue: true,
      beforeAmount: 100,
      proposedHadValue: true,
      proposedAmount: 600,
    }));
  });

  it('shows legacy aggregate Actual removals for human review before the one-time sheet overwrite', async () => {
    const matrix = buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS);
    matrix[28][3] = '-';
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        actual: { SALES_IN: 123 },
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
      .send({ idempotencyKey: 'refresh-legacy-actual' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-legacy-actual' })
      .expect(200);

    expect(stage.body.candidates).toContainEqual(expect.objectContaining({
      mode: 'actual',
      yearMonth: '2026-01',
      weekNo: 1,
      lineId: 'SALES_IN',
      beforeHadValue: true,
      beforeAmount: 123,
      proposedHadValue: false,
      proposedAmount: null,
    }));
  });

  it('blocks the whole month when any canonical week is closed', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
      weeks: [{
        id: 'project-a-2026-01-w1',
        projectId: 'project-a',
        yearMonth: '2026-01',
        weekNo: 1,
        adminClosed: true,
      }],
    });
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
        })),
      },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-closed-month' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-closed-month' })
      .expect(200);

    expect(stage.body).toMatchObject({
      status: 'BLOCKED',
      blockedMonths: ['2026-01'],
      stagedLineCount: 0,
      riskLineCount: 160,
    });
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(0);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_months/')).toHaveLength(0);
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

  it('applies a staged pinned month through JVM without rereading the Google Sheet', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
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
        const matrix = buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS);
        matrix[4][3] = '';
        return {
          spreadsheetId: 'spreadsheet-a',
          spreadsheetTitle: 'Cashflow workbook',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix,
        };
      }),
    };
    const resultingTargetRevision = `sha256:${'1'.repeat(64)}`;
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, yearMonth, cells, sourceRevision, targetRevision }) => ({
        ok: true,
        projectId,
        commandName: 'weeklyExpense.cashflowSheetLab.apply',
        yearMonth,
        sourceRevision,
        targetRevision,
        resultingTargetRevision,
        savedProjectionLineCount: cells.filter((cell) => cell.mode === 'projection').length,
        savedActualLineCount: cells.filter((cell) => cell.mode === 'actual').length,
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
      appliedLineCount: 160,
      projectionLineCount: 80,
      actualLineCount: 80,
      skippedRiskLineCount: 0,
      stagedRunId: stage.body.runId,
    });
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(1);
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a',
      sourceRevision: mirror.body.sourceRevision,
      targetRevision: mirror.body.targetRevisionAtFetch,
      yearMonth: '2026-01',
      cells: expect.arrayContaining([
        expect.objectContaining({
          mode: 'projection',
          weekNo: 1,
          cashflowLine: 'MYSC_PREPAY_IN',
          cellState: 'VALUE',
          amount: 999,
        }),
        expect.objectContaining({
          mode: 'actual',
          weekNo: 1,
          cashflowLine: 'BANK_INTEREST_OUT',
          cellState: 'VALUE',
          amount: 999,
        }),
      ]),
    }));
    expect(javaWeeklyClient.applyCashflowSheetLab.mock.calls[0][0].cells).toHaveLength(160);
    expect(db.__getQueries()).toContainEqual({
      path: 'orgs/tenant-a/cashflow_change_candidates',
      field: 'runId',
      op: '==',
      value: stage.body.runId,
    });
    const emptyCell = javaWeeklyClient.applyCashflowSheetLab.mock.calls[0][0].cells.find((cell) => (
      cell.mode === 'projection' && cell.cashflowLine === 'MYSC_PREPAY_LABOR_IN'
    ));
    expect(emptyCell).toMatchObject({ cellState: 'EMPTY' });
    expect(emptyCell).not.toHaveProperty('amount');
    expect(replay.body).toEqual(apply.body);
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1')).toMatchObject({
      projection: { MYSC_PREPAY_IN: 100 },
      actual: { MYSC_PREPAY_IN: 200 },
    });
  });

  it('rejects a multi-month mirror before staging any authoritative write', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-2-5',
        },
      },
    });
    const twoFullMonths = [
      ...JANUARY_FINANCE_WEEKS,
      '26-2-1', '26-2-2', '26-2-3', '26-2-4', '26-2-5',
    ];
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrixWithWeekLabels(twoFullMonths),
      })),
    };
    const javaWeeklyClient = { applyCashflowSheetLab: vi.fn() };
    const app = createApp({
      db,
      googleSheetsService,
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });

    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-two-months' })
      .expect(200);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-two-months' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_stage_single_month_required');
      });

    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_change_candidates/')).toHaveLength(0);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_runs/')).toHaveLength(0);
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_months/')).toHaveLength(0);
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
  });

  it('resumes an uncertain single-month apply with the server-pinned idempotency key', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
    }));
    const resultingTargetRevision = `sha256:${'3'.repeat(64)}`;
    let attempts = 0;
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, yearMonth, sourceRevision, targetRevision }) => {
        if (attempts++ === 0) {
          throw Object.assign(new Error('temporary JVM failure'), {
            statusCode: 503,
            code: 'weekly_api_unavailable',
          });
        }
        return {
          ok: true,
          projectId,
          yearMonth,
          sourceRevision,
          targetRevision,
          resultingTargetRevision,
        };
      }),
    };
    const app = createApp({
      db,
      googleSheetsService: { previewSpreadsheet },
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-resume-months' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-resume-months' })
      .expect(200);
    const headers = {
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '7',
      'x-edit-finalize': 'true',
    };
    const firstPayload = { stageRunId: stage.body.runId, idempotencyKey: 'apply-resume-first' };

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set(headers)
      .send(firstPayload)
      .expect(503);
    expect(db.__getDocument(`orgs/tenant-a/cashflow_sheet_stage_runs/${stage.body.runId}`).status).toBe('APPLYING');

    const retry = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set(headers)
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-resume-after-reload' })
      .expect(200);

    expect(retry.body.resultingTargetRevision).toBe(resultingTargetRevision);
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(2);
    const calls = javaWeeklyClient.applyCashflowSheetLab.mock.calls.map(([call]) => call);
    expect(calls.map((call) => call.yearMonth)).toEqual(['2026-01', '2026-01']);
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
    expect(calls[0].targetRevision).toBe(mirror.body.targetRevisionAtFetch);
    expect(calls[1].targetRevision).toBe(mirror.body.targetRevisionAtFetch);
    expect(previewSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it('uses a new JVM idempotency key after a rejected apply is safely returned to READY', async () => {
    const db = createDb({
      project: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-5',
        },
      },
    });
    const previewSpreadsheet = vi.fn(async () => ({
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
      matrix: buildMatrixWithWeekLabels(JANUARY_FINANCE_WEEKS),
    }));
    const resultingTargetRevision = `sha256:${'4'.repeat(64)}`;
    let attempts = 0;
    const javaWeeklyClient = {
      applyCashflowSheetLab: vi.fn(async ({ projectId, yearMonth, sourceRevision, targetRevision }) => {
        if (attempts++ === 0) {
          throw Object.assign(new Error('validation rejected'), {
            statusCode: 422,
            code: 'cashflow_sheet_validation_failed',
          });
        }
        return {
          ok: true,
          projectId,
          yearMonth,
          sourceRevision,
          targetRevision,
          resultingTargetRevision,
        };
      }),
    };
    const app = createApp({
      db,
      googleSheetsService: { previewSpreadsheet },
      routeOptions: { editLeasesEnabled: true, javaWeeklyClient },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-rejected-retry' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-rejected-retry' })
      .expect(200);
    const headers = {
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '7',
    };

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set(headers)
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-rejected-first' })
      .expect(422);
    expect(db.__getDocument(`orgs/tenant-a/cashflow_sheet_stage_runs/${stage.body.runId}`).status).toBe('READY');
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set(headers)
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-rejected-second' })
      .expect(200);

    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledTimes(2);
    const calls = javaWeeklyClient.applyCashflowSheetLab.mock.calls.map(([call]) => call);
    expect(calls[0].idempotencyKey).not.toBe(calls[1].idempotencyKey);
  });

  it('blocks a partial month instead of authoritatively replacing only weeks 4 and 5', async () => {
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
    const javaWeeklyClient = { applyCashflowSheetLab: vi.fn() };

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
    expect(stage.body).toMatchObject({
      status: 'BLOCKED',
      blockedMonths: ['2026-02'],
      stagedLineCount: 0,
    });
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .set({
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({ stageRunId: stage.body.runId, idempotencyKey: 'apply-002' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('cashflow_sheet_stage_run_blocked');
      });
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
    expect(db.__getDocument('orgs/tenant-a/cashflow_weeks/project-a-2026-02-w4')).toBeUndefined();
  });

  it('blocks weeks 1 and 2 because they are not a complete five-week finance month', async () => {
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
    const app = createApp({
      db,
      googleSheetsService: {
        previewSpreadsheet: vi.fn(async () => ({
          spreadsheetId: 'spreadsheet-a',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
          matrix: buildMatrixWithWeekLabels(['26-1-1', '26-1-2']),
        })),
      },
    });
    const mirror = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/mirror/refresh')
      .send({ idempotencyKey: 'refresh-partial-leading-weeks' })
      .expect(200);
    const stage = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/stage')
      .send({ expectedMirrorRevision: mirror.body.sourceRevision, idempotencyKey: 'stage-partial-leading-weeks' })
      .expect(200);

    expect(stage.body).toMatchObject({
      status: 'BLOCKED',
      blockedMonths: ['2026-01'],
      stagedLineCount: 0,
    });
    expect(db.__getDocumentsByPrefix('orgs/tenant-a/cashflow_sheet_stage_months/')).toHaveLength(0);
  });

  it('retires both sheet write-back routes for inbound-only finance sync', async () => {
    const previewSpreadsheet = vi.fn();
    const batchUpdateValues = vi.fn();
    const app = createApp({ googleSheetsService: { previewSpreadsheet, batchUpdateValues } });

    for (const path of [
      '/api/v1/projects/project-a/cashflow-sheet-lab/writeback/preview',
      '/api/v1/projects/project-a/cashflow-sheet-lab/writeback/apply',
    ]) {
      await request(app)
        .post(path)
        .send({})
        .expect(410)
        .expect((response) => {
          expect(response.body.code).toBe('cashflow_sheet_writeback_retired');
        });
    }

    expect(previewSpreadsheet).not.toHaveBeenCalled();
    expect(batchUpdateValues).not.toHaveBeenCalled();
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
