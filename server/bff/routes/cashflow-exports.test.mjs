import express from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountCashflowExportRoutes } from './cashflow-exports.mjs';

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

function createExportApp(projects) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = { tenantId: 'tenant-a', actorRole: 'admin' };
    next();
  });
  mountCashflowExportRoutes(app, {
    rbacPolicy: { rolePermissions: { admin: ['cashflow:export'] } },
    db: {
      collection(path) {
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
    const app = createExportApp([
      { id: 'p-b', name: '나 사업', shortName: 'B', department: '센터A', accountType: 'OTHER' },
      { id: 'p-a', name: '가 사업', shortName: 'A', department: '센터A', accountType: 'DEDICATED' },
      { id: 'p-account', name: '다 사업', shortName: 'ACCOUNT', department: '센터A', accountType: 'OPERATING' },
      { id: 'p-department', name: '라 사업', shortName: 'DEPARTMENT', department: '센터B', accountType: 'DEDICATED' },
    ]);

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
        endYearMonth: '2024-01',
        variant: 'multi-sheet',
      })
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(['A', 'B']);
    expect(decodeURIComponent(response.headers['content-disposition'])).toContain('선택사업_개별시트');
  });
});
