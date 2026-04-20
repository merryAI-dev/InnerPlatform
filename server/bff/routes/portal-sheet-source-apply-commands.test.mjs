import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalSheetSourceApplyCommandRoutes } from './portal-sheet-source-apply-commands.mjs';

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

function createFakeDb(seedDocs = {}) {
  const docs = new Map(Object.entries(seedDocs));

  return {
    docs,
    doc(path) {
      return { path };
    },
    async runTransaction(work) {
      const pendingSets = [];
      const tx = {
        async get(ref) {
          return createDocSnapshot(ref.path, docs.get(ref.path));
        },
        set(ref, value, options = { merge: false }) {
          pendingSets.push({ path: ref.path, value, options });
        },
      };
      const result = await work(tx);
      for (const entry of pendingSets) {
        const current = docs.get(entry.path);
        if (entry.options?.merge && current && typeof current === 'object') {
          docs.set(entry.path, { ...current, ...entry.value });
        } else {
          docs.set(entry.path, entry.value);
        }
      }
      return result;
    },
  };
}

function createApp(db, auditEntries = []) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'mysc',
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-sheet-source-apply',
      idempotencyKey: 'idem-sheet-source-apply',
    };
    next();
  });

  mountPortalSheetSourceApplyCommandRoutes(app, {
    db,
    now: () => '2026-04-17T13:30:00.000Z',
    idempotencyService: {},
    createMutatingRoute: (_idempotencyService, handler) => async (req, res, next) => {
      try {
        const result = await handler(req, res);
        if (!result || res.headersSent) return;
        res.status(result.status || 200).json(result.body);
      } catch (error) {
        next(error);
      }
    },
    auditChainService: {
      async append(entry) {
        auditEntries.push(entry);
      },
    },
  });

  app.use((error, _req, res, _next) => {
    res.status(error?.statusCode || 500).json({
      error: error?.code || 'internal_error',
      message: error?.message || 'Request failed',
    });
  });

  return app;
}

describe('portal sheet source apply command routes', () => {
  it('marks a sheet source as applied for an existing project', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/sheet-source/apply')
      .set('idempotency-key', 'idem-sheet-source-apply')
      .send({
        projectId: 'p001',
        sourceType: 'usage',
        applyTarget: '월별 사용내역',
      });

    expect(response.status).toBe(200);
    expect(response.body.sheetSource).toEqual({
      tenantId: 'mysc',
      projectId: 'p001',
      sourceType: 'usage',
      applyTarget: '월별 사용내역',
      lastAppliedAt: '2026-04-17T13:30:00.000Z',
      updatedAt: '2026-04-17T13:30:00.000Z',
      updatedBy: 'pm-1',
    });
    expect(db.docs.get('orgs/mysc/projects/p001/sheet_sources/usage')).toEqual({
      tenantId: 'mysc',
      projectId: 'p001',
      sourceType: 'usage',
      applyTarget: '월별 사용내역',
      lastAppliedAt: '2026-04-17T13:30:00.000Z',
      updatedAt: '2026-04-17T13:30:00.000Z',
      updatedBy: 'pm-1',
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects missing projects', async () => {
    const db = createFakeDb({});
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/sheet-source/apply')
      .set('idempotency-key', 'idem-sheet-source-apply-missing-project')
      .send({
        projectId: 'p404',
        sourceType: 'usage',
        applyTarget: '월별 사용내역',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('project_not_found');
  });

  it('rejects invalid payloads', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/sheet-source/apply')
      .set('idempotency-key', 'idem-sheet-source-apply-invalid')
      .send({
        projectId: 'p001',
        sourceType: 'usage',
        applyTarget: '',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_sheet_source_apply');
  });
});
