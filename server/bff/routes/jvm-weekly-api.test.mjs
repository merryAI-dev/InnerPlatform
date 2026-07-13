import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { mountJvmWeeklyApiRoutes } from './jvm-weekly-api.mjs';

function createIdempotencyService() {
  return {
    begin: vi.fn(async () => ({ mode: 'new', requestFingerprint: 'fp' })),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
}

const stageEnv = {
  BFF_DEPLOY_ENV: 'stage',
  BFF_EDIT_LEASES_ENABLED: 'true',
  VITE_FIREBASE_PROJECT_ID: 'stage-data-project',
  JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'stage-data-project',
};

const editLeaseHeaders = {
  'x-edit-session-id': 'session-a',
  'x-edit-lease-id': 'lease-a',
  'x-edit-fence': '7',
};

const canonicalWriterRoutes = [
  '/api/v1/weekly-expenses/project-a/sheets/default/save-draft',
  '/api/v1/weekly-expenses/project-a/bank-statements/import-batch',
  '/api/v1/weekly-expenses/project-a/bank-statements/apply-items',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/copy',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/paste',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/cut',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/row-insert',
  '/api/v1/weekly-expenses/project-a/sheets/default/commands/row-delete',
  '/api/v1/weekly-expenses/project-a/submit',
  '/api/v1/weekly-expenses/project-a/close',
  '/api/v1/cashflow/project-a/projection',
];

function createApp(fetchImpl, idempotencyService = createIdempotencyService(), contextPatch = {}, routeOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.context = {
      tenantId: 'tenant-a',
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
      requestId: 'req-1',
      idempotencyKey: req.header('idempotency-key') || undefined,
      ...contextPatch,
    };
    next();
  });
  mountJvmWeeklyApiRoutes(app, {
    idempotencyService,
    fetchImpl,
    jvmWeeklyApiBaseUrl: 'http://jvm-weekly.local',
    jvmWeeklyApiServiceToken: 'test-service-token',
    ...routeOptions,
  });
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({
      code: error.code || 'error',
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  });
  return { app, idempotencyService };
}

describe('JVM weekly API BFF proxy', () => {
  it('rejects every canonical weekly writer before the JVM when the cashflow lease is missing', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
    }, { env: stageEnv });

    for (const path of canonicalWriterRoutes) {
      await request(app)
        .post(path)
        .set('idempotency-key', `missing-lease-${canonicalWriterRoutes.indexOf(path)}`)
        .send({})
        .expect(400)
        .expect((response) => {
          expect(response.body.code).toBe('cashflow_edit_lease_request_invalid');
        });
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(canonicalWriterRoutes)(
    'forwards the same validated cashflow lease to canonical writer %s',
    async (path) => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
    }, { env: stageEnv });

      await request(app)
        .post(path)
        .set({
          'idempotency-key': `valid-lease-${canonicalWriterRoutes.indexOf(path)}`,
          ...editLeaseHeaders,
        })
        .send({})
        .expect(200);

      expect(calls).toHaveLength(1);
      expect(calls[0].init.headers).toMatchObject({
        'x-data-project-id': 'stage-data-project',
        ...editLeaseHeaders,
      });
      expect(calls[0].init.headers['x-edit-finalize']).toBeUndefined();
    },
  );

  it('forwards only the canonical final-save signal to the JVM', async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      init,
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1', actorRole: 'admin',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/cashflow/project-a/projection')
      .set({
        'idempotency-key': 'final-projection-1',
        ...editLeaseHeaders,
        'x-edit-finalize': 'true',
      })
      .send({ lines: [] })
      .expect(200);

    expect(fetchImpl.mock.calls[0][1].headers['x-edit-finalize']).toBe('true');
  });

  it.each(['1', 'TRUE', 'yes', 'false'])(
    'rejects ambiguous edit finalization value %s before the JVM',
    async (finalize) => {
      const fetchImpl = vi.fn();
      const { app } = createApp(fetchImpl, createIdempotencyService(), {
        actorId: 'admin-1', actorRole: 'admin',
      }, { env: stageEnv });

      await request(app)
        .post('/api/v1/cashflow/project-a/projection')
        .set({
          'idempotency-key': `bad-finalize-${finalize}`,
          ...editLeaseHeaders,
          'x-edit-finalize': finalize,
        })
        .send({ lines: [] })
        .expect(400);

      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '-1', '01', '1e2', '1.0', '9007199254740992'])(
    'rejects non-canonical edit fence %s before the JVM',
    async (fence) => {
      const fetchImpl = vi.fn();
      const { app } = createApp(fetchImpl, createIdempotencyService(), {
        actorId: 'admin-1',
        actorRole: 'admin',
      }, { env: stageEnv });

      await request(app)
        .post('/api/v1/weekly-expenses/project-a/sheets/default/save-draft')
        .set({
          'idempotency-key': `bad-fence-${fence}`,
          ...editLeaseHeaders,
          'x-edit-fence': fence,
        })
        .send({})
        .expect(400);

      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('preserves the JVM atomic write count in the BFF 422 error contract', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({
        code: 'atomic_write_limit_exceeded',
        message: 'Projection command requires 501 writes.',
        expectedWriteCount: 501,
      }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/cashflow/project-a/projection')
      .set({ 'idempotency-key': 'atomic-limit-1', ...editLeaseHeaders })
      .send({ lines: [] })
      .expect(422)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 'atomic_write_limit_exceeded',
          details: { expectedWriteCount: 501 },
        });
      });
  });

  it('forwards Stage cashflow projection lease headers and rejects caller source context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, projectId: 'project-a' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1',
      actorRole: 'finance',
    }, {
      env: {
        BFF_DEPLOY_ENV: 'stage',
        BFF_EDIT_LEASES_ENABLED: 'true',
        FIREBASE_PROJECT_ID: 'stage-data-project',
        JVM_WEEKLY_FIRESTORE_PROJECT_ID: 'stage-data-project',
      },
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/projection')
      .set({
        'idempotency-key': 'projection-stage-1',
        'x-edit-session-id': 'session-a',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      })
      .send({
        sourceSheetKey: 'caller-controlled',
        actor: { id: 'spoofed', role: 'admin' },
        tenantId: 'spoofed',
        lines: [{ yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'x-data-project-id': 'stage-data-project',
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '7',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'projection-stage-1',
      lines: [{ yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }],
    });
  });

  it('fails closed before JVM cashflow projection when edit leases are disabled', async () => {
    const fetchImpl = vi.fn();
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1',
      actorRole: 'finance',
    });

    await request(app)
      .post('/api/v1/cashflow/project-a/projection')
      .set('idempotency-key', 'projection-disabled-1')
      .send({ lines: [{ yearMonth: '2026-07', weekNo: 1, cashflowLine: 'SALES_IN', amount: 1000 }] })
      .expect(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('forwards only trusted context headers and strips client actor/tenant body fields', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch')
      .set({ 'idempotency-key': 'idem-proxy-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
      'x-actor-email': 'pm@example.com',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-proxy-1',
      cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
    });
  });

  it('does not use BFF Firestore idempotency for Java-owned commands', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    const idempotencyService = createIdempotencyService();
    idempotencyService.begin.mockImplementation(async () => {
      throw new Error('BFF idempotency must not run for Java weekly commands');
    });
    const { app } = createApp(fetchImpl, idempotencyService, {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/cell-patch')
      .set({ 'idempotency-key': 'idem-java-owned-1', ...editLeaseHeaders })
      .send({
        cells: [{ rowIndex: 0, columnIndex: 1, rawValue: '1000' }],
      })
      .expect(200);

    expect(idempotencyService.begin).not.toHaveBeenCalled();
    expect(idempotencyService.complete).not.toHaveBeenCalled();
    expect(idempotencyService.fail).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('proxies server clipboard copy commands through the Java API', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          commandName: 'weeklyExpense.cells.copy',
          clipboard: { operationType: 'COPY', rowCount: 1, columnCount: 2, cells: [] },
        }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/sheets/default/commands/copy')
      .set({ 'idempotency-key': 'idem-copy-1', ...editLeaseHeaders })
      .send({
        expectedSheetVersion: 3,
        startRow: 0,
        startColumn: 3,
        endRow: 0,
        endColumn: 4,
        depth: 'DEEP',
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.commandName).toBe('weeklyExpense.cells.copy');
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default/commands/copy');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-copy-1',
      expectedSheetVersion: 3,
      startRow: 0,
      startColumn: 3,
      endRow: 0,
      endColumn: 4,
      depth: 'DEEP',
    });
  });

  it('proxies cashflow snapshot reads with trusted tenant context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ projectId: 'project-a', projection: [], actual: [] }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a' });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a');
    expect(calls[0].init.headers['x-inner-platform-service-token']).toBe('test-service-token');
    expect(calls[0].init.headers['x-tenant-id']).toBe('tenant-a');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('proxies weekly expense sheet read-back through trusted Java context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a',
          sheetKey: 'default',
          rows: [{ id: 'row-1', cells: [] }],
          sheetVersion: 7,
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/sheets/default')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a', sheetKey: 'default', sheetVersion: 7 });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets/default');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });

  it('proxies weekly expense sheet list reads for Java-backed portal hydration', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          projectId: 'project-a',
          sheets: [{ sheetKey: 'default', rows: [], sheetVersion: 1 }],
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/sheets')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ projectId: 'project-a', sheets: [{ sheetKey: 'default', sheetVersion: 1 }] });
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/sheets');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('adds a Google identity token when the Java Cloud Run audience is configured', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (String(url).startsWith('http://metadata.google.internal/')) {
        return {
          ok: true,
          status: 200,
          text: async () => 'metadata-id-token',
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ projectId: 'project-a', projection: [], actual: [] }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, {
      jvmWeeklyApiIdTokenAudience: 'https://innerplatform-jvm-weekly-api.run.app',
    });

    await request(app)
      .get('/api/v1/cashflow/project-a')
      .expect(200);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('metadata.google.internal');
    expect(calls[0].url).toContain('audience=https%3A%2F%2Finnerplatform-jvm-weekly-api.run.app');
    expect(calls[0].init.headers).toMatchObject({ 'Metadata-Flavor': 'Google' });
    expect(calls[1].url).toBe('http://jvm-weekly.local/api/v1/cashflow/project-a');
    expect(calls[1].init.headers.authorization).toBe('Bearer metadata-id-token');
    expect(calls[1].init.headers['x-inner-platform-service-token']).toBe('test-service-token');
  });

  it('proxies audit export creation as a finance-only Java command', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-1',
      actorRole: 'finance',
      actorEmail: 'finance@example.com',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-export-1')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        format: 'CSV',
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/audit-export');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'finance-1',
      'x-actor-role': 'finance',
      'x-actor-email': 'finance@example.com',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-export-1',
      format: 'CSV',
    });
  });

  it('preserves real Java roles for mysc users when JVM auth mode is strict', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'finance-mysc-1',
      actorRole: 'finance',
      actorEmail: 'finance@mysc.co.kr',
      actorName: '재무 사용자',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-strict-mysc-export-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'x-actor-id': 'finance-mysc-1',
      'x-actor-role': 'finance',
      'x-actor-email': 'finance@mysc.co.kr',
      'x-actor-name': encodeURIComponent('재무 사용자'),
    });
  });

  it('does not relax finance-only Java weekly routes for workspace users in strict mode', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'viewer-mysc-1',
      actorRole: 'viewer',
      actorEmail: 'viewer@mysc.co.kr',
    });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-strict-viewer-export-1')
      .send({ format: 'CSV' })
      .expect(403);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lets mysc workspace users run scoped Java weekly commands when JVM auth mode is workspace', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(
      fetchImpl,
      createIdempotencyService(),
      {
        actorId: 'workspace-1',
        actorRole: 'viewer',
        actorEmail: 'workspace@mysc.co.kr',
        actorName: '민욱 사용자',
      },
      { jvmWeeklyAuthMode: 'internal_saas_workspace' },
    );

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-workspace-export-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/audit-export');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'workspace-1',
      'x-actor-role': 'workspace_user',
      'x-actor-email': 'workspace@mysc.co.kr',
      'x-actor-name': encodeURIComponent('민욱 사용자'),
    });
  });

  it('uses the configured workspace email domain when relaxing Java weekly roles', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.auditExport.create' }),
      };
    });
    const { app } = createApp(
      fetchImpl,
      createIdempotencyService(),
      {
        actorId: 'workspace-2',
        actorRole: 'viewer',
        actorEmail: 'workspace@example.org',
      },
      {
        jvmWeeklyAuthMode: 'internal_saas_workspace',
        jvmWeeklyWorkspaceEmailDomain: 'example.org',
      },
    );

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/audit-export')
      .set('idempotency-key', 'idem-workspace-export-custom-domain-1')
      .send({ format: 'CSV' })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({
      'x-actor-id': 'workspace-2',
      'x-actor-role': 'workspace_user',
      'x-actor-email': 'workspace@example.org',
    });
  });

  it('forwards a compound weekly sheet snapshot and FINAL_SAVE header to Java submit', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.submitWeek', state: 'submitted' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'pm-1',
      actorRole: 'pm',
      actorEmail: 'pm@example.com',
    }, { env: stageEnv });
    const weeklySheet = {
      sheetKey: 'default',
      expectedSheetVersion: 3,
      sheetName: '기본 탭',
      rows: [{ rowIndex: 0, entryKind: 'manual', cells: [] }],
    };

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/submit')
      .set({ 'idempotency-key': 'idem-submit-compound-1', ...editLeaseHeaders, 'x-edit-finalize': 'true' })
      .send({ yearMonth: '2026-06', weekNo: 1, weeklySheet })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({ 'x-edit-finalize': 'true' });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-submit-compound-1',
      yearMonth: '2026-06',
      weekNo: 1,
      weeklySheet,
    });
  });

  it('proxies compound weekly close as an admin-only Java final command', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, commandName: 'weeklyExpense.closeWeek', state: 'closed' }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {
      actorId: 'admin-1',
      actorRole: 'admin',
      actorEmail: 'admin@example.com',
    }, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/close')
      .set({ 'idempotency-key': 'idem-close-1', ...editLeaseHeaders, 'x-edit-finalize': 'true' })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        yearMonth: '2026-06',
        weekNo: 1,
        projectionLines: [{ yearMonth: '2026-06', weekNo: 1, cashflowLine: 'SALES_IN', amount: 2500 }],
      })
      .expect(200);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/close');
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'admin-1',
      'x-actor-role': 'admin',
      'x-actor-email': 'admin@example.com',
      'x-edit-finalize': 'true',
    });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-close-1',
      yearMonth: '2026-06',
      weekNo: 1,
      projectionLines: [{ yearMonth: '2026-06', weekNo: 1, cashflowLine: 'SALES_IN', amount: 2500 }],
    });
  });

  it('proxies bank statement import and apply commands through trusted Java context', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    });
    const { app } = createApp(fetchImpl, createIdempotencyService(), {}, { env: stageEnv });

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/bank-statements/import-batch')
      .set({ 'idempotency-key': 'idem-bank-import-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        columns: ['거래일시', '금액'],
        lines: [{ lineIndex: 0, sourceLineKey: 'bank:1', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] }],
      })
      .expect(200);

    await request(app)
      .post('/api/v1/weekly-expenses/project-a/bank-statements/apply-items')
      .set({ 'idempotency-key': 'idem-bank-apply-1', ...editLeaseHeaders })
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
        sheetKey: 'default',
        items: [{ importLineId: 'line-1', cells: [{ columnIndex: 8, rawValue: '사업비' }] }],
      })
      .expect(200);

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/import-batch');
    expect(calls[1].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/apply-items');
    expect(JSON.parse(calls[0].init.body)).toEqual({
      idempotencyKey: 'idem-bank-import-1',
      columns: ['거래일시', '금액'],
      lines: [{ lineIndex: 0, sourceLineKey: 'bank:1', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] }],
    });
    expect(JSON.parse(calls[1].init.body)).toEqual({
      idempotencyKey: 'idem-bank-apply-1',
      sheetKey: 'default',
      items: [{ importLineId: 'line-1', cells: [{ columnIndex: 8, rawValue: '사업비' }] }],
    });
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });

  it('proxies bank statement import line reads through trusted Java context without a request body', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          ok: true,
          projectId: 'project-a',
          status: 'all',
          lines: [
            { id: 'line-1', sourceLineKey: 'bank:1', status: 'staged', signedAmount: -1000, rawCells: ['2026-06-01', '-1000'] },
          ],
        }),
      };
    });
    const { app } = createApp(fetchImpl);

    await request(app)
      .get('/api/v1/weekly-expenses/project-a/bank-statements/import-lines?status=all')
      .send({
        tenantId: 'spoofed-tenant',
        actor: { id: 'spoofed-admin', role: 'admin' },
      })
      .expect(200)
      .expect((response) => {
        expect(response.body.lines).toHaveLength(1);
        expect(response.body.lines[0].id).toBe('line-1');
      });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://jvm-weekly.local/api/v1/weekly-expenses/project-a/bank-statements/import-lines?status=all');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).toMatchObject({
      'x-tenant-id': 'tenant-a',
      'x-inner-platform-service-token': 'test-service-token',
      'x-actor-id': 'pm-1',
      'x-actor-role': 'pm',
    });
  });
});
