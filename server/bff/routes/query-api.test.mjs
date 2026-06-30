import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountQueryApiRoutes } from './query-api.mjs';

function createDb() {
  const documents = new Map([
    ['orgs/tenant-a/projects/project-a', {
      id: 'project-a',
      name: 'Project A',
      status: 'IN_PROGRESS',
      department: 'Finance',
      managerId: 'manager-a',
    }],
    ['orgs/tenant-a/projects/project-b', {
      id: 'project-b',
      name: 'Beta Search Project',
      status: 'IN_PROGRESS',
      department: 'Impact',
      managerId: 'manager-b',
    }],
    ['orgs/tenant-a/projects/project-c', {
      id: 'project-c',
      name: 'Closed Project',
      status: 'COMPLETED',
      department: 'Impact',
      managerId: 'manager-b',
    }],
    ['orgs/tenant-a/cashflow_weeks/project-a-2026-01-w1', {
      id: 'project-a-2026-01-w1',
      projectId: 'project-a',
      yearMonth: '2026-01',
      weekNo: 1,
      projection: { SALES_IN: 1000, DIRECT_COST_OUT: 300 },
      actual: { SALES_IN: 700, DIRECT_COST_OUT: 200 },
    }],
    ['orgs/tenant-a/cashflow_weeks/project-a-2026-01-w2', {
      id: 'project-a-2026-01-w2',
      projectId: 'project-a',
      yearMonth: '2026-01',
      weekNo: 2,
      projection: { TEAM_SUPPORT_IN: 500, INPUT_VAT_OUT: 100 },
      actual: { TEAM_SUPPORT_IN: 300, INPUT_VAT_OUT: 50 },
    }],
    ['orgs/tenant-a/cashflow_weeks/other-2026-01-w1', {
      id: 'other-2026-01-w1',
      projectId: 'other',
      yearMonth: '2026-01',
      weekNo: 1,
      actual: { SALES_IN: 999999 },
    }],
  ]);

  return {
    doc: vi.fn((path) => ({
      get: vi.fn(async () => ({
        exists: documents.has(path),
        data: () => documents.get(path),
      })),
    })),
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
  };
}

function createApp({ context = {} } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorRole: 'finance',
      actorEmail: 'finance@mysc.co.kr',
      requestId: 'req-1',
      ...context,
    };
    next();
  });
  mountQueryApiRoutes(app, {
    db: createDb(),
    now: () => '2026-06-30T00:00:00.000Z',
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: error.code || 'error',
      message: error.message,
      requestId: 'req-1',
    });
  });
  return app;
}

describe('query api routes', () => {
  it('lists projects with simple search filters', async () => {
    const response = await request(createApp())
      .get('/api/v1/query/projects?query=beta&status=IN_PROGRESS&pageSize=10')
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          id: 'project-b',
          name: 'Beta Search Project',
          status: 'IN_PROGRESS',
          department: 'Impact',
          managerId: 'manager-b',
        },
      ],
      count: 1,
      nextCursor: null,
      source: {
        readModel: 'projects',
        freshnessCheckedAt: '2026-06-30T00:00:00.000Z',
      },
    });
  });

  it('returns a cashflow summary from canonical cashflow weeks', async () => {
    const response = await request(createApp())
      .get('/api/v1/query/projects/project-a/cashflow-summary?startYearMonth=2026-01&endYearMonth=2026-01')
      .expect(200);

    expect(response.body).toEqual({
      data: {
        projectId: 'project-a',
        projectName: 'Project A',
        requestedMode: 'all',
        range: {
          startYearMonth: '2026-01',
          endYearMonth: '2026-01',
          weekCount: 2,
        },
        modes: {
          projection: { totalIn: 1500, totalOut: 400, net: 1100 },
          actual: { totalIn: 1000, totalOut: 250, net: 750 },
        },
      },
      source: {
        readModel: 'cashflow_weeks',
        freshnessCheckedAt: '2026-06-30T00:00:00.000Z',
      },
    });
  });

  it('returns cashflow weeks in range with a mode filter', async () => {
    const response = await request(createApp())
      .get('/api/v1/query/projects/project-a/cashflow-weeks?startYearMonth=2026-01&endYearMonth=2026-01&mode=actual')
      .expect(200);

    expect(response.body).toEqual({
      items: [
        {
          id: 'project-a-2026-01-w1',
          projectId: 'project-a',
          yearMonth: '2026-01',
          weekNo: 1,
          actual: { SALES_IN: 700, DIRECT_COST_OUT: 200 },
        },
        {
          id: 'project-a-2026-01-w2',
          projectId: 'project-a',
          yearMonth: '2026-01',
          weekNo: 2,
          actual: { TEAM_SUPPORT_IN: 300, INPUT_VAT_OUT: 50 },
        },
      ],
      count: 2,
      nextCursor: null,
      source: {
        readModel: 'cashflow_weeks',
        freshnessCheckedAt: '2026-06-30T00:00:00.000Z',
      },
    });
  });

  it('rejects invalid year-month filters', async () => {
    const response = await request(createApp())
      .get('/api/v1/query/projects/project-a/cashflow-summary?startYearMonth=2026-99&endYearMonth=2026-01')
      .expect(400);

    expect(response.body.error).toBe('invalid_query');
  });

  it('rejects callers outside the workspace access boundary', async () => {
    const response = await request(createApp({
      context: {
        actorRole: 'guest',
        actorEmail: 'external@example.com',
      },
    }))
      .get('/api/v1/query/projects/project-a/cashflow-summary?startYearMonth=2026-01&endYearMonth=2026-01')
      .expect(403);

    expect(response.body.error).toBe('forbidden');
  });
});
