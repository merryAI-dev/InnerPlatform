import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountCashflowSheetLabRoutes } from './cashflow-sheet-lab.mjs';

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

function buildSection(actual = false) {
  const weekRow = ['', '', '', '26-1-1', '26-1-2', '26-1-3'];
  return [
    [actual ? 'ACTUAL' : 'Projection'],
    weekRow,
    ...IN_LABELS.map((label) => [label, '', '', '999']),
    ['입금 합계', '', '', '999'],
    ...OUT_LABELS.map((label) => [label, '', '', '999']),
    [actual ? '잔액' : '잔액 (※ 중요)', '', '', '999'],
  ];
}

function buildMatrix() {
  return [
    ['title'],
    ...buildSection(false),
    [],
    ...buildSection(true),
    ['note', 'ignored'],
  ];
}

function createDb({ exists = true, data = { id: 'project-a' } } = {}) {
  let document = { ...data };
  const get = vi.fn(async () => ({
    exists,
    data: () => document,
  }));
  const set = vi.fn(async (patch) => {
    document = { ...document, ...patch };
  });
  return {
    doc: vi.fn(() => ({ get, set })),
    __getDocument: () => document,
    __set: set,
  };
}

function createApp({
  context = {},
  googleSheetsService,
  javaWeeklyClient,
  db = createDb(),
  bffProjectId = 'bff-firestore-a',
} = {}) {
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
  const resolvedJavaWeeklyClient = javaWeeklyClient
    ? { firestoreProjectId: 'bff-firestore-a', ...javaWeeklyClient }
    : {
        workspaceEmailDomain: 'mysc.co.kr',
        firestoreProjectId: 'bff-firestore-a',
        getCashflowSnapshot: vi.fn(async () => ({
          projectId: 'project-a',
          weeks: [{ yearMonth: '2026-01', weekNo: 1, projection: { SALES_IN: 123 }, actual: { SALES_IN: 456 } }],
        })),
      };
  mountCashflowSheetLabRoutes(app, {
    db,
    googleSheetsService: googleSheetsService || {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })),
    },
    javaWeeklyClient: resolvedJavaWeeklyClient,
    bffProjectId,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      code: error.code || 'error',
      message: error.message,
    });
  });
  return app;
}

describe('cashflow sheet lab route', () => {
  it('returns an empty saved sheet config before the first setup', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .expect(200);

    expect(response.body).toEqual({
      projectId: 'project-a',
      configured: false,
      config: null,
    });
  });

  it('saves the validated cashflow sheet config for later previews', async () => {
    const db = createDb();

    const response = await request(createApp({ db }))
      .put('/api/v1/projects/project-a/cashflow-sheet-lab/config')
      .send({
        value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1',
        sheetName: 'cashflow(사용내역 연동)',
        startWeek: '26-1-1',
        endWeek: '26-1-3',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      projectId: 'project-a',
      configured: true,
      config: {
        value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1',
        sheetName: 'cashflow(사용내역 연동)',
        spreadsheetId: 'spreadsheet-a',
        startWeek: '26-1-1',
        endWeek: '26-1-3',
        updatedBy: {
          email: 'user@mysc.co.kr',
          role: 'workspace_user',
        },
      },
    });
    expect(db.__getDocument().cashflowSheetLab).toMatchObject(response.body.config);
  });

  it('filters preview values to the saved project week range', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-2',
          endWeek: '26-1-2',
        },
      },
    });

    const response = await request(createApp({ db }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ includeValues: false })
      .expect(200);

    expect(response.body.activeWeekRange).toEqual({
      startWeek: '26-1-2',
      endWeek: '26-1-2',
    });
    expect(response.body.previewValues).toHaveLength(24);
    expect(new Set(response.body.previewValues.map((value) => value.weekNo))).toEqual(new Set([2]));
  });

  it('applies saved sheet values to Java for both projection and actual', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      getCashflowSnapshot: vi.fn(),
      applyCashflowSheetLab: vi.fn(async () => ({
        ok: true,
        commandName: 'weeklyExpense.cashflowSheetLab.apply',
        projectId: 'project-a',
        sourceSheetKey: 'cashflow-sheet-lab',
        savedProjectionLineCount: 24,
        savedActualLineCount: 24,
        auditId: 'audit-1',
      })),
    };

    const response = await request(createApp({ db, javaWeeklyClient }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-001' })
      .expect(200);

    expect(response.body).toMatchObject({
      projectId: 'project-a',
      appliedLineCount: 48,
      projectionLineCount: 24,
      actualLineCount: 24,
    });
    expect(javaWeeklyClient.applyCashflowSheetLab).toHaveBeenCalledOnce();
    const call = javaWeeklyClient.applyCashflowSheetLab.mock.calls[0][0];
    expect(call).toMatchObject({
      projectId: 'project-a',
      idempotencyKey: 'apply-001',
      sourceSheetKey: 'cashflow-sheet-lab',
    });
    expect(call.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: 'projection',
        yearMonth: '2026-01',
        weekNo: 1,
        cashflowLine: 'MYSC_PREPAY_IN',
        amount: 999,
      }),
      expect.objectContaining({
        mode: 'projection',
        yearMonth: '2026-01',
        weekNo: 2,
        cashflowLine: 'MYSC_PREPAY_IN',
        amount: 0,
      }),
      expect.objectContaining({
        mode: 'actual',
        yearMonth: '2026-01',
        weekNo: 1,
        cashflowLine: 'SALES_IN',
        amount: 999,
      }),
    ]));
  });

  it('blocks apply when BFF stores sheet config and Java writes a different Firestore project', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      firestoreProjectId: 'different-firestore',
      applyCashflowSheetLab: vi.fn(async () => ({
        ok: true,
        commandName: 'weeklyExpense.cashflowSheetLab.apply',
        projectId: 'project-a',
        sourceSheetKey: 'cashflow-sheet-lab',
        savedProjectionLineCount: 24,
        savedActualLineCount: 24,
        auditId: 'audit-1',
      })),
    };
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix: buildMatrix(),
      })),
    };

    const response = await request(createApp({ db, javaWeeklyClient, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-mismatch-001' })
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'cashflow_sheet_apply_environment_mismatch',
    });
    expect(response.body.message).toContain('Align the environments');
    expect(googleSheetsService.previewSpreadsheet).not.toHaveBeenCalled();
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
  });

  it('fails closed when apply cannot identify the BFF Firestore project', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      firestoreProjectId: 'bff-firestore-a',
      applyCashflowSheetLab: vi.fn(),
    };

    const response = await request(createApp({ db, javaWeeklyClient, bffProjectId: '' }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-missing-env-001' })
      .expect(409);

    expect(response.body.code).toBe('cashflow_sheet_apply_environment_mismatch');
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
  });

  it('fails closed when apply cannot identify the Java Firestore project', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      firestoreProjectId: '',
      applyCashflowSheetLab: vi.fn(),
    };

    const response = await request(createApp({ db, javaWeeklyClient }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-missing-java-env-001' })
      .expect(409);

    expect(response.body.code).toBe('cashflow_sheet_apply_environment_mismatch');
    expect(javaWeeklyClient.applyCashflowSheetLab).not.toHaveBeenCalled();
  });

  it('parses Google Sheets formatted currency values before applying to Java', async () => {
    const matrix = buildMatrix();
    matrix[3][3] = '₩5,000,000';
    matrix[3][4] = '5,000,000원';
    matrix[4][3] = '−500,000';
    matrix[20][3] = '(1,250,000)';
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-1-2',
        },
      },
    });
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      applyCashflowSheetLab: vi.fn(async () => ({
        ok: true,
        commandName: 'weeklyExpense.cashflowSheetLab.apply',
        projectId: 'project-a',
        sourceSheetKey: 'cashflow-sheet-lab',
        savedProjectionLineCount: 24,
        savedActualLineCount: 24,
        auditId: 'audit-1',
      })),
    };
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [{ sheetId: 1, title: 'cashflow(사용내역 연동)', index: 0 }],
        matrix,
      })),
    };

    await request(createApp({ db, javaWeeklyClient, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/apply')
      .send({ idempotencyKey: 'apply-currency-001' })
      .expect(200);

    const call = javaWeeklyClient.applyCashflowSheetLab.mock.calls[0][0];
    expect(call.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: 'projection',
        weekNo: 1,
        cashflowLine: 'MYSC_PREPAY_IN',
        amount: 5000000,
      }),
      expect.objectContaining({
        mode: 'projection',
        weekNo: 2,
        cashflowLine: 'MYSC_PREPAY_IN',
        amount: 5000000,
      }),
      expect.objectContaining({
        mode: 'projection',
        weekNo: 1,
        cashflowLine: 'SALES_IN',
        amount: -500000,
      }),
      expect.objectContaining({
        mode: 'actual',
        weekNo: 1,
        cashflowLine: 'MYSC_PREPAY_IN',
        amount: -1250000,
      }),
    ]));
  });

  it('uses the saved sheet config when preview is requested without a sheet link', async () => {
    const db = createDb({
      data: {
        id: 'project-a',
        cashflowSheetLab: {
          value: 'saved-spreadsheet-a',
          sheetName: 'cashflow(사용내역 연동)',
          spreadsheetId: 'saved-spreadsheet-a',
        },
      },
    });
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'saved-spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [],
        matrix: buildMatrix(),
      })),
    };

    const response = await request(createApp({ db, googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ includeValues: false })
      .expect(200);

    expect(response.body.accessPolicy.sheetConfigSource).toBe('saved_config');
    expect(googleSheetsService.previewSpreadsheet).toHaveBeenCalledWith({
      value: 'saved-spreadsheet-a',
      sheetName: 'cashflow(사용내역 연동)',
      rangeA1: 'A1:ZZ220',
    });
  });

  it('allows mysc workspace users and returns sheet mapping plus Java snapshot status', async () => {
    const response = await request(createApp())
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'https://docs.google.com/spreadsheets/d/spreadsheet-a/edit#gid=1' })
      .expect(200);

    expect(response.body).toMatchObject({
      projectId: 'project-a',
      spreadsheetId: 'spreadsheet-a',
      selectedSheetName: 'cashflow(사용내역 연동)',
      cashflowSnapshotStatus: 'ready',
      accessPolicy: {
        googleAuth: 'service_account',
        googleScope: 'spreadsheets.readonly',
        valueSource: 'java_cashflow_read_model',
        actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
        sheetReadRange: 'A1:ZZ220',
        sheetPreviewCache: 'miss',
        sheetNamePolicy: 'cashflow_usage_linked_only',
      },
    });
    expect(response.body.template.supported).toBe(true);
    expect(response.body.template.sections.map((section) => section.mode)).toEqual(['projection', 'actual']);
    expect(response.body.template.mappingCandidates).toHaveLength(72);
    expect(response.body.template.mappingCandidates[0]).toMatchObject({
      mode: 'projection',
      lineId: 'MYSC_PREPAY_IN',
      source: 'sheet_layout',
    });
    expect(response.body.previewValues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: 'projection',
        lineId: 'SALES_IN',
        yearMonth: '2026-01',
        weekNo: 1,
        sheetValue: '999',
        amount: 123,
        source: 'java_read_model',
      }),
      expect.objectContaining({
        mode: 'actual',
        lineId: 'SALES_IN',
        yearMonth: '2026-01',
        weekNo: 1,
        sheetValue: '999',
        amount: 456,
        source: 'java_read_model',
      }),
    ]));
    expect(response.body).not.toHaveProperty('cashflowSnapshot');
  });

  it('sends mysc actors to Java as workspace_user for this read-only lab path', async () => {
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      getCashflowSnapshot: vi.fn(async () => ({ projectId: 'project-a', weeks: [] })),
    };

    await request(createApp({
      context: {
        actorRole: 'pm',
        actorEmail: 'pm@mysc.co.kr',
      },
      javaWeeklyClient,
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(javaWeeklyClient.getCashflowSnapshot).toHaveBeenCalledWith({
      context: expect.objectContaining({
        actorRole: 'workspace_user',
        actorEmail: 'pm@mysc.co.kr',
      }),
      projectId: 'project-a',
    });
  });

  it('does not pass user Google OAuth tokens to the service-account Sheets preview', async () => {
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [],
        matrix: buildMatrix(),
      })),
    };
    const app = createApp({ googleSheetsService });

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .set('x-google-access-token', 'user-token-must-not-be-used')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(googleSheetsService.previewSpreadsheet).toHaveBeenCalledWith({
      value: 'spreadsheet-a',
      sheetName: undefined,
      rangeA1: 'A1:ZZ220',
    });
  });

  it('reuses the short-lived sheet layout cache but still reads Java values per request', async () => {
    let javaAmount = 100;
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: 'cashflow(사용내역 연동)',
        availableSheets: [],
        matrix: buildMatrix(),
      })),
    };
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      getCashflowSnapshot: vi.fn(async () => {
        javaAmount += 1;
        return {
          projectId: 'project-a',
          readModel: {
            months: [{
              yearMonth: '2026-01',
              projection: { weeks: [{ weekNo: 1, amounts: { SALES_IN: javaAmount } }] },
              actual: { weeks: [] },
            }],
          },
        };
      }),
    };
    const app = createApp({ googleSheetsService, javaWeeklyClient });

    const first = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);
    const second = await request(app)
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(googleSheetsService.previewSpreadsheet).toHaveBeenCalledTimes(1);
    expect(javaWeeklyClient.getCashflowSnapshot).toHaveBeenCalledTimes(2);
    expect(first.body.accessPolicy.sheetPreviewCache).toBe('miss');
    expect(second.body.accessPolicy.sheetPreviewCache).toBe('hit');
    expect(first.body.previewValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'projection', lineId: 'SALES_IN', amount: 101 }),
    ]));
    expect(second.body.previewValues).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'projection', lineId: 'SALES_IN', amount: 102 }),
    ]));
  });

  it('returns sheet layout first when Java values are deferred', async () => {
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      getCashflowSnapshot: vi.fn(async () => ({ projectId: 'project-a', weeks: [] })),
    };

    const response = await request(createApp({ javaWeeklyClient }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a', includeValues: false })
      .expect(200);

    expect(response.body.cashflowSnapshotStatus).toBe('pending');
    expect(response.body.previewValues[0]).toMatchObject({
      sheetValue: '999',
      amount: null,
    });
    expect(javaWeeklyClient.getCashflowSnapshot).not.toHaveBeenCalled();
  });

  it('auto-selects the cashflow usage linked tab when no sheet name is provided', async () => {
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async ({ sheetName }) => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: sheetName || '요약',
        availableSheets: [
          { sheetId: 1, title: '요약', index: 0 },
          { sheetId: 2, title: 'cashflow(사용내역 연동)', index: 1 },
        ],
        matrix: buildMatrix(),
      })),
    };

    const response = await request(createApp({ googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(response.body.selectedSheetName).toBe('cashflow(사용내역 연동)');
    expect(googleSheetsService.previewSpreadsheet).toHaveBeenNthCalledWith(2, {
      value: 'spreadsheet-a',
      sheetName: 'cashflow(사용내역 연동)',
      rangeA1: 'A1:ZZ220',
    });
  });

  it('rejects non-cashflow usage linked sheet tabs', async () => {
    const googleSheetsService = {
      previewSpreadsheet: vi.fn(async () => ({
        spreadsheetId: 'spreadsheet-a',
        spreadsheetTitle: 'Cashflow workbook',
        selectedSheetName: '요약',
        availableSheets: [{ sheetId: 1, title: '요약', index: 0 }],
        matrix: buildMatrix(),
      })),
    };

    await request(createApp({ googleSheetsService }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(400);
  });

  it('allows mysc email even when actor role is only a recorded workspace user role', async () => {
    await request(createApp({
      context: {
        actorRole: '',
        actorEmail: 'teammate@mysc.co.kr',
      },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);
  });

  it('denies non-workspace users', async () => {
    await request(createApp({
      context: {
        actorRole: 'contractor',
        actorEmail: 'external@example.com',
      },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(403);
  });

  it('denies external emails even when a recorded role is allowed', async () => {
    await request(createApp({
      context: {
        actorRole: 'pm',
        actorEmail: 'pm@example.com',
      },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(403);

    await request(createApp({
      context: {
        actorRole: 'admin',
        actorEmail: 'admin@example.com',
      },
    }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(403);
  });

  it('keeps mapping available but does not synthesize values when Java is unconfigured', async () => {
    const javaWeeklyClient = {
      workspaceEmailDomain: 'mysc.co.kr',
      getCashflowSnapshot: vi.fn(async () => {
        const error = new Error('JVM weekly API base URL is not configured.');
        error.code = 'jvm_weekly_api_unconfigured';
        throw error;
      }),
    };

    const response = await request(createApp({ javaWeeklyClient }))
      .post('/api/v1/projects/project-a/cashflow-sheet-lab/preview')
      .send({ value: 'spreadsheet-a' })
      .expect(200);

    expect(response.body.cashflowSnapshotStatus).toBe('unavailable');
    expect(response.body).not.toHaveProperty('cashflowSnapshot');
    expect(response.body.template.mappingCandidates[0]).toMatchObject({
      source: 'sheet_layout',
    });
    expect(response.body.previewValues[0]).toMatchObject({
      amount: null,
      source: 'java_read_model',
    });
  });
});
