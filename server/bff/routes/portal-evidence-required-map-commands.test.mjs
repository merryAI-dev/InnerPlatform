import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { mountPortalEvidenceRequiredMapCommandRoutes } from './portal-evidence-required-map-commands.mjs';

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
      requestId: 'req-evidence-required-map-save',
      idempotencyKey: 'idem-evidence-required-map-save',
    };
    next();
  });

  mountPortalEvidenceRequiredMapCommandRoutes(app, {
    db,
    now: () => '2026-04-17T13:00:00.000Z',
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

describe('portal evidence required map command routes', () => {
  it('saves the evidence required map for an existing project', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
      'orgs/mysc/budgetEvidenceMaps/p001': {
        projectId: 'p001',
        map: {
          '인건비|급여': '계약서',
        },
      },
    });
    const auditEntries = [];
    const app = createApp(db, auditEntries);

    const response = await request(app)
      .post('/api/v1/portal/evidence-required-map/save')
      .set('idempotency-key', 'idem-evidence-required-map-save')
      .send({
        projectId: 'p001',
        map: {
          '인건비|급여': '출근부',
          '운영비|소모품': '영수증',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.evidenceRequiredMap).toEqual({
      '인건비|급여': '출근부',
      '운영비|소모품': '영수증',
    });
    expect(response.body.summary).toMatchObject({
      projectId: 'p001',
      entryCount: 2,
    });
    expect(db.docs.get('orgs/mysc/budgetEvidenceMaps/p001')?.map).toEqual({
      '인건비|급여': '출근부',
      '운영비|소모품': '영수증',
    });
    expect(auditEntries).toHaveLength(1);
  });

  it('rejects saves for missing projects', async () => {
    const db = createFakeDb({});
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/evidence-required-map/save')
      .set('idempotency-key', 'idem-evidence-required-map-missing-project')
      .send({
        projectId: 'p404',
        map: {
          '인건비|급여': '출근부',
        },
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('project_not_found');
  });

  it('rejects invalid evidence required map payloads', async () => {
    const db = createFakeDb({
      'orgs/mysc/projects/p001': {
        id: 'p001',
        name: '알파 프로젝트',
      },
    });
    const app = createApp(db, []);

    const response = await request(app)
      .post('/api/v1/portal/evidence-required-map/save')
      .set('idempotency-key', 'idem-evidence-required-map-invalid')
      .send({
        projectId: 'p001',
        map: [],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_evidence_required_map');
  });
});
