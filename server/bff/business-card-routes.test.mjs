import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildEmptyBusinessCardExtraction } from './business-card-domain.mjs';
import { mountBusinessCardRoutes } from './routes/business-cards.mjs';

function createIdempotencyService() {
  return {
    begin: vi.fn(async () => ({ mode: 'claim', requestFingerprint: 'fp_test' })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  };
}

function createRouteHarness({ actorRole = 'admin', db, storage, gemini, rbacPolicy } = {}) {
  const app = express();
  const idempotencyService = createIdempotencyService();
  const auditChainService = { append: vi.fn(async () => undefined) };
  const piiProtector = { encryptText: vi.fn(async (value) => ({ ciphertext: `enc:${value}` })) };

  app.use(express.json({ limit: '25mb' }));
  app.use((req, _res, next) => {
    req.context = {
      tenantId: req.header('x-tenant-id') || 'mysc',
      actorId: req.header('x-actor-id') || 'u001',
      actorRole,
      actorEmail: req.header('x-actor-email') || 'user@mysc.co.kr',
      requestId: 'req_test',
      idempotencyKey: req.header('idempotency-key') || 'idem_test',
    };
    next();
  });

  mountBusinessCardRoutes(app, {
    db,
    now: () => '2026-05-23T00:00:00.000Z',
    idempotencyService,
    auditChainService,
    piiProtector,
    rbacPolicy: rbacPolicy || {
      rolePermissions: {
        admin: ['contact:read', 'contact:write', 'contact:image:read'],
      },
    },
    businessCardStorageService: storage,
    businessCardGeminiAiService: gemini,
  });

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      error: error.code || 'internal_error',
      message: error.message,
    });
  });

  return { app, idempotencyService, auditChainService };
}

describe('business-card routes', () => {
  it('processes images through BFF without exposing the private Storage path', async () => {
    const storedDocs = new Map();
    const db = {
      doc: vi.fn((path) => ({
        set: vi.fn(async (data) => {
          storedDocs.set(path, data);
        }),
      })),
    };
    const storage = {
      uploadBusinessCard: vi.fn(async () => ({
        path: 'orgs/mysc/business-cards/u001/bcimp_001-card.jpg',
        name: 'card.jpg',
        size: 10,
        contentType: 'image/jpeg',
      })),
    };
    const gemini = {
      analyzeBusinessCard: vi.fn(async () => ({
        provider: 'vertex-ai',
        model: 'gemini-test',
        status: 'manual_review',
        extracted: buildEmptyBusinessCardExtraction(['수동 검토 필요']),
        error: { code: 'gemini_not_configured', message: 'not configured' },
      })),
    };
    const { app, auditChainService } = createRouteHarness({ db, storage, gemini });

    const response = await request(app)
      .post('/api/v1/business-card-imports/process')
      .set({ 'idempotency-key': 'idem_bc_process_001' })
      .send({
        fileName: 'card.jpg',
        mimeType: 'image/jpeg',
        fileSize: 10,
        contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      importId: expect.stringMatching(/^bcimp_/),
      status: 'needs_review',
      extracted: expect.objectContaining({
        warnings: ['수동 검토 필요'],
      }),
    });
    expect(response.body.storagePath).toBeUndefined();
    expect(storage.uploadBusinessCard).toHaveBeenCalledTimes(1);
    expect(Array.from(storedDocs.values())[0]).toMatchObject({
      storagePath: 'orgs/mysc/business-cards/u001/bcimp_001-card.jpg',
      status: 'needs_review',
    });
    expect(auditChainService.append).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'business_card_import',
      action: 'PROCESS',
    }));
  });

  it('blocks actors without contact write permission before storage upload', async () => {
    const storage = {
      uploadBusinessCard: vi.fn(async () => {
        throw new Error('should not upload');
      }),
    };
    const { app } = createRouteHarness({
      actorRole: 'blocked',
      db: { doc: vi.fn() },
      storage,
      gemini: { analyzeBusinessCard: vi.fn() },
      rbacPolicy: {
        rolePermissions: {
          blocked: [],
        },
      },
    });

    const response = await request(app)
      .post('/api/v1/business-card-imports/process')
      .set({ 'idempotency-key': 'idem_bc_process_forbidden' })
      .send({
        fileName: 'card.jpg',
        mimeType: 'image/jpeg',
        fileSize: 10,
        contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('forbidden');
    expect(storage.uploadBusinessCard).not.toHaveBeenCalled();
  });

  it('does not confirm failed imports as contacts', async () => {
    const txSet = vi.fn();
    const db = {
      doc: vi.fn((path) => ({ path })),
      runTransaction: vi.fn(async (callback) => callback({
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({
            status: 'failed',
            storagePath: 'orgs/mysc/business-cards/u001/bcimp_failed-card.jpg',
          }),
        })),
        set: txSet,
      })),
    };
    const { app } = createRouteHarness({
      db,
      storage: { uploadBusinessCard: vi.fn() },
      gemini: { analyzeBusinessCard: vi.fn() },
    });

    const response = await request(app)
      .post('/api/v1/business-card-imports/bcimp_failed/confirm')
      .set({ 'idempotency-key': 'idem_bc_confirm_failed' })
      .send({
        name: '홍길동',
        organization: '',
        department: '',
        title: '',
        role: '',
        emails: ['person@example.com'],
        phones: [],
        website: '',
        address: '',
        memo: '',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('import_not_confirmable');
    expect(txSet).not.toHaveBeenCalled();
  });

  it('lists contacts when the search query is blank', async () => {
    const get = vi.fn(async () => ({
      docs: [
        {
          id: 'ct_001',
          data: () => ({
            name: '홍길동',
            organization: 'MYSC',
            emails: ['person@example.com'],
            phones: ['01012345678'],
            memo: '첫 미팅',
            updatedAt: '2026-05-23T00:00:00.000Z',
          }),
        },
      ],
    }));
    const limit = vi.fn(() => ({ get }));
    const orderBy = vi.fn(() => ({ limit }));
    const collection = vi.fn(() => ({ orderBy }));
    const { app } = createRouteHarness({
      db: { collection },
      storage: { uploadBusinessCard: vi.fn() },
      gemini: { analyzeBusinessCard: vi.fn() },
    });

    const response = await request(app).get('/api/v1/contacts?query=');

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: 'ct_001',
      name: '홍길동',
      memo: '첫 미팅',
    });
    expect(collection).toHaveBeenCalledWith('orgs/mysc/contacts');
  });

  it('updates contacts through the BFF and rebuilds search fields', async () => {
    const txSet = vi.fn();
    const db = {
      doc: vi.fn((path) => ({ path })),
      runTransaction: vi.fn(async (callback) => callback({
        get: vi.fn(async () => ({
          exists: true,
          data: () => ({
            id: 'ct_001',
            tenantId: 'mysc',
            visibility: 'org',
            name: '기존 이름',
            organization: 'MYSC',
            emails: ['old@example.com'],
            phones: [],
            createdAt: '2026-05-22T00:00:00.000Z',
          }),
        })),
        set: txSet,
      })),
    };
    const { app, auditChainService } = createRouteHarness({
      db,
      storage: { uploadBusinessCard: vi.fn() },
      gemini: { analyzeBusinessCard: vi.fn() },
    });

    const response = await request(app)
      .patch('/api/v1/contacts/ct_001')
      .set({ 'idempotency-key': 'idem_contact_update_001' })
      .send({
        name: '새 이름',
        organization: 'MYSC',
        department: 'AX',
        title: '리드',
        role: '',
        emails: ['new@example.com'],
        phones: [],
        website: '',
        address: '',
        memo: 'PC에서 수정',
      });

    expect(response.status).toBe(200);
    expect(response.body.contact).toMatchObject({
      id: 'ct_001',
      name: '새 이름',
      memo: 'PC에서 수정',
    });
    expect(txSet).toHaveBeenCalledWith(
      { path: 'orgs/mysc/contacts/ct_001' },
      expect.objectContaining({
        name: '새 이름',
        memo: 'PC에서 수정',
        primaryEmail: 'new@example.com',
        updatedBy: 'u001',
      }),
      { merge: true },
    );
    expect(auditChainService.append).toHaveBeenCalledWith(expect.objectContaining({
      entityType: 'contact',
      action: 'UPDATE',
    }));
  });
});
