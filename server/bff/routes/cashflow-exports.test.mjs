import express from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountCashflowExportRoutes } from './cashflow-exports.mjs';
import { CASHFLOW_ALL_LINES } from '../cashflow-policy.mjs';

function snapshot(records) {
  return {
    docs: records.map((record) => ({
      id: record.id,
      data: () => ({ ...record }),
    })),
  };
}

function emptyQuery() {
  return {
    where() { return this; },
    async get() { return snapshot([]); },
  };
}

function parseBinaryResponse(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', callback);
}

function completeMirror(projectId, amount = 900, overrides = {}) {
  const revisionCharacter = projectId === 'p-a' ? 'a' : 'b';
  const sourceRevision = `sha256:${revisionCharacter.repeat(64)}`;
  const cells = [];
  for (const mode of ['projection', 'actual']) {
    for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
      for (const lineId of CASHFLOW_ALL_LINES) {
        cells.push({
          mode,
          yearMonth: '2026-01',
          weekNo,
          lineId,
          direction: lineId.endsWith('_IN') ? 'IN' : 'OUT',
          state: weekNo === 1 && lineId === 'SALES_IN'
            ? (mode === 'projection' ? 'VALUE' : 'ZERO')
            : 'EMPTY',
          ...(weekNo === 1 && lineId === 'SALES_IN' ? { amount: mode === 'projection' ? amount : 0 } : {}),
        });
      }
    }
  }
  const weeklyCalculationChecks = [];
  for (const mode of ['projection', 'actual']) {
    for (let weekNo = 1; weekNo <= 5; weekNo += 1) {
      weeklyCalculationChecks.push({
        mode,
        yearMonth: '2026-01',
        weekNo,
        reported: {
          openingBalance: mode === 'projection' ? 5_000 : 4_000,
          depositTotal: mode === 'projection' && weekNo === 1 ? amount : 0,
          withdrawalTotal: 0,
          balance: mode === 'projection' ? 5_000 + amount : 4_000,
        },
      });
    }
  }
  const annualMode = (salesAmount, balance) => ({
    source: 'ANNUAL',
    lineAmounts: { SALES_IN: salesAmount },
    lineStates: Object.fromEntries(CASHFLOW_ALL_LINES.map((lineId) => [
      lineId,
      lineId === 'SALES_IN' ? (salesAmount === 0 ? 'ZERO' : 'VALUE') : 'EMPTY',
    ])),
    totalIn: salesAmount,
    totalOut: 0,
    net: balance,
  });
  const annualCells = [];
  const annualDerivedCells = [];
  for (const mode of ['projection', 'actual']) {
    const salesAmount = mode === 'projection' ? amount : 0;
    const balance = mode === 'projection' ? 5_000 + amount : 4_000;
    for (const lineId of CASHFLOW_ALL_LINES) {
      const selected = lineId === 'SALES_IN';
      annualCells.push({
        mode,
        year: 2024,
        periodKind: 'ANNUAL',
        lineId,
        direction: lineId.endsWith('_IN') ? 'IN' : 'OUT',
        state: selected ? (salesAmount === 0 ? 'ZERO' : 'VALUE') : 'EMPTY',
        ...(selected ? { amount: salesAmount } : {}),
      });
    }
    annualDerivedCells.push(
      { mode, year: 2024, periodKind: 'ANNUAL', derivedKind: 'deposit_total', state: salesAmount === 0 ? 'ZERO' : 'VALUE', amount: salesAmount },
      { mode, year: 2024, periodKind: 'ANNUAL', derivedKind: 'withdrawal_total', state: 'ZERO', amount: 0 },
      { mode, year: 2024, periodKind: 'ANNUAL', derivedKind: 'balance', state: 'VALUE', amount: balance },
    );
  }
  return {
    projectId,
    weeklyYear: 2026,
    status: 'FRESH',
    sourceRevision,
    appliedSourceRevision: sourceRevision,
    cells,
    annualCells,
    annualDerivedCells,
    sheetFacts: {
      weeklyCalculationChecks,
      annualCashflowTotals: [{
        year: 2024,
        projection: annualMode(9_999, 9_999),
        actual: annualMode(9_999, 9_999),
      }],
    },
    ...overrides,
  };
}

function createExportApp(projects, { mirrors = {}, onCollectionRead = () => {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: 'tenant-a', actorRole: 'admin' };
    next();
  });
  mountCashflowExportRoutes(app, {
    rbacPolicy: { rolePermissions: { admin: ['cashflow:export'] } },
    db: {
      doc(path) {
        return {
          async get() {
            const projectMatch = /\/projects\/([^/]+)$/.exec(path);
            if (projectMatch) {
              const project = projects.find(({ id }) => id === projectMatch[1]);
              return project
                ? { id: project.id, exists: true, data: () => ({ ...project }) }
                : { id: projectMatch[1], exists: false, data: () => undefined };
            }
            const mirrorMatch = /\/cashflow_sheet_mirrors\/([^/]+)$/.exec(path);
            const mirror = mirrorMatch ? mirrors[mirrorMatch[1]] : null;
            return mirror
              ? { id: mirrorMatch[1], exists: true, data: () => ({ ...mirror }) }
              : { id: mirrorMatch?.[1] || '', exists: false, data: () => undefined };
          },
        };
      },
      collection(path) {
        onCollectionRead(path);
        if (path.endsWith('/projects')) return { get: async () => snapshot(projects) };
        return emptyQuery();
      },
    },
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || error.status || 500).json({ error: error.code || 'error', message: error.message });
  });
  return app;
}

describe('cashflow export route contract', () => {
  it('does not expose the legacy BFF canonical-write routes', async () => {
    const app = express();
    app.use(express.json());
    mountCashflowExportRoutes(app, { db: {}, rbacPolicy: {} });

    await request(app)
      .post('/api/v1/projects/project-a/cashflow-weeks/upsert')
      .send({})
      .expect(404);
    await request(app)
      .post('/api/v1/projects/project-a/cashflow-actuals/sync')
      .send({})
      .expect(404);
  });

  it('cross-filters canonical projects and applies department ordering to the workbook', async () => {
    const projects = [
      { id: 'p-b', name: '나 사업', shortName: 'B', department: '센터A', accountType: 'OTHER' },
      { id: 'p-a', name: '가 사업', shortName: 'A', department: '센터A', accountType: 'DEDICATED' },
      { id: 'p-account', name: '다 사업', shortName: 'ACCOUNT', department: '센터A', accountType: 'OPERATING' },
      { id: 'p-department', name: '라 사업', shortName: 'DEPARTMENT', department: '센터B', accountType: 'DEDICATED' },
    ];
    const app = createExportApp(projects, {
      mirrors: { 'p-a': completeMirror('p-a'), 'p-b': completeMirror('p-b') },
    });

    const response = await request(app)
      .post('/api/v1/cashflow-exports')
      .buffer(true)
      .parse(parseBinaryResponse)
      .send({
        scope: 'selected',
        projectIds: ['p-b', 'p-a', 'p-account', 'p-department'],
        department: '센터A',
        accountTypes: ['DEDICATED', 'OTHER'],
        sortBy: 'DEPARTMENT',
        startYearMonth: '2024-01',
        endYearMonth: '2024-12',
        variant: 'multi-sheet',
      })
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['A', 'B']);
    const firstSheetRows = workbook.getWorksheet('A').getSheetValues().filter(Boolean)
      .map((row) => Array.isArray(row) ? row.slice(1) : []);
    expect(firstSheetRows.find((row) => row[0] === '항목')).toEqual(['항목', '2024']);
    expect(firstSheetRows.find((row) => row[0] === '매출액(입금)')).toEqual(['매출액(입금)', 900]);
    expect(decodeURIComponent(response.headers['content-disposition'])).toContain('선택사업_개별시트');
  });

  it('exports the applied mirror value and never reads stale cashflow_weeks', async () => {
    const collectionReads = [];
    const app = createExportApp([
      { id: 'p-a', name: '가 사업', accountType: 'DEDICATED' },
    ], {
      mirrors: { 'p-a': completeMirror('p-a', 900) },
      onCollectionRead: (path) => collectionReads.push(path),
    });

    const response = await request(app)
      .post('/api/v1/cashflow-exports')
      .buffer(true)
      .parse(parseBinaryResponse)
      .send({
        scope: 'single',
        projectId: 'p-a',
        startYearMonth: '2026-01',
        endYearMonth: '2026-01',
        variant: 'single-project',
      })
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const rows = workbook.getWorksheet('Projection').getSheetValues()
      .filter(Boolean)
      .map((row) => Array.isArray(row) ? row.slice(1) : []);
    expect(rows.find((row) => row[0] === '매출액(입금)')).toEqual(['매출액(입금)', 900]);
    expect(rows.find((row) => row[0] === '입금 합계')).toEqual([
      '입금 합계', 900, 0, 0, 0, 0,
    ]);
    expect(rows.find((row) => row[0] === '잔액')).toEqual([
      '잔액', 5900, 5900, 5900, 5900, 5900,
    ]);
    const actualRows = workbook.getWorksheet('Actual').getSheetValues()
      .filter(Boolean)
      .map((row) => Array.isArray(row) ? row.slice(1) : []);
    expect(actualRows.find((row) => row[0] === '매출액(입금)')).toEqual([
      '매출액(입금)', 0,
    ]);
    const salesRowNumber = workbook.getWorksheet('Projection').getSheetValues()
      .findIndex((row) => Array.isArray(row) && row[1] === '매출액(입금)');
    expect(workbook.getWorksheet('Projection').getCell(salesRowNumber, 7).value).toBeNull();
    expect(collectionReads.some((path) => path.endsWith('/cashflow_weeks'))).toBe(false);
  });

  it('blocks the whole workbook when any selected project mirror is unavailable', async () => {
    const app = createExportApp([
      { id: 'p-a', name: '가 사업', accountType: 'DEDICATED' },
      { id: 'p-b', name: '나 사업', accountType: 'DEDICATED' },
    ], {
      mirrors: {
        'p-a': completeMirror('p-a'),
        'p-b': completeMirror('p-b', 700, { appliedSourceRevision: 'sha256:not-applied' }),
      },
    });

    const response = await request(app)
      .post('/api/v1/cashflow-exports')
      .send({
        scope: 'selected',
        projectIds: ['p-a', 'p-b'],
        startYearMonth: '2026-01',
        endYearMonth: '2026-01',
        variant: 'multi-sheet',
      })
      .expect(409);

    expect(response.body).toMatchObject({ error: 'cashflow_export_source_unavailable' });
  });

  it('reports a stored mirror shape violation as the canonical template mismatch', async () => {
    const mirror = completeMirror('p-a');
    mirror.cells.pop();
    const app = createExportApp([
      { id: 'p-a', name: '가 사업', accountType: 'DEDICATED' },
    ], { mirrors: { 'p-a': mirror } });

    const response = await request(app)
      .post('/api/v1/cashflow-exports')
      .send({
        scope: 'single',
        projectId: 'p-a',
        startYearMonth: '2026-01',
        endYearMonth: '2026-01',
        variant: 'single-project',
      })
      .expect(409);

    expect(response.body).toMatchObject({
      error: 'cashflow_sheet_template_mismatch',
      message: '양식이 다릅니다.',
    });
  });
});
