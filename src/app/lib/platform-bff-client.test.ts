import { describe, expect, it, vi } from 'vitest';
import {
  addCommentViaBff,
  addEvidenceViaBff,
  analyzeGoogleSheetImportViaBff,
  analyzeProjectRequestContractViaBff,
  applyWeeklyExpenseBankStatementItemsViaBff,
  changeTransactionStateViaBff,
  copyWeeklyExpenseCellsViaBff,
  cutWeeklyExpenseCellsViaBff,
  deepSyncAuthGovernanceUserViaBff,
  deleteWeeklyExpenseRowsViaBff,
  exportCashflowWorkbookViaBff,
  fetchAuthGovernanceUsersViaBff,
  fetchWeeklyExpenseBankStatementImportLinesViaBff,
  fetchWeeklyExpenseCashflowViaBff,
  fetchWeeklyExpenseStatusesViaBff,
  importWeeklyExpenseBankStatementBatchViaBff,
  insertWeeklyExpenseRowsViaBff,
  linkProjectEvidenceDriveRootViaBff,
  notifyProjectRequestRegistrationViaBff,
  pasteWeeklyExpenseCellsViaBff,
  patchWeeklyExpenseCellsViaBff,
  reviewProjectExecutiveStatusViaBff,
  overrideTransactionEvidenceDriveCategoriesViaBff,
  previewGoogleSheetImportViaBff,
  processProjectRequestContractViaBff,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  readPlatformApiRuntimeConfig,
  createPlatformApiClient,
  restoreProjectViaBff,
  closeWeeklyExpenseWeekViaBff,
  syncTransactionEvidenceDriveViaBff,
  trashProjectViaBff,
  uploadProjectSheetSourceViaBff,
  uploadProjectRequestContractViaBff,
  submitWeeklyExpenseWeekViaBff,
  toRequestActor,
  updateContactViaBff,
  uploadTransactionEvidenceDriveViaBff,
  upsertLedgerViaBff,
  upsertWeeklyExpenseProjectionViaBff,
  type PlatformApiClientLike,
  upsertProjectViaBff,
  upsertTransactionViaBff,
} from './platform-bff-client';

function asMockClient<T extends {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}>(client: T): T & PlatformApiClientLike {
  return client as T & PlatformApiClientLike;
}

describe('platform-bff-client', () => {
  it('reads runtime config with defaults', () => {
    expect(readPlatformApiRuntimeConfig({})).toEqual({
      enabled: false,
      baseUrl: 'http://127.0.0.1:8787',
      legacyBaseUrl: 'http://127.0.0.1:8787',
    });
  });

  it('requires explicit Java API base URL when production platform API is enabled', () => {
    expect(() => readPlatformApiRuntimeConfig({ PROD: 'true' })).toThrow(
      'VITE_PLATFORM_API_BASE_URL is required for stage/live platform API operation.',
    );
    expect(readPlatformApiRuntimeConfig({
      PROD: 'true',
      VITE_PLATFORM_API_BASE_URL: 'https://java-api.example.run.app/',
    })).toEqual({
      enabled: true,
      baseUrl: 'https://java-api.example.run.app',
      legacyBaseUrl: '',
    });
  });

  it('routes only weekly and cashflow paths to Java API while preserving legacy BFF routes', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/v1/weekly-expenses/p-cashflow/statuses')) {
        return new Response(JSON.stringify({ projectId: 'p-cashflow', statuses: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-weekly' },
        });
      }
      if (url.includes('/api/v1/projects')) {
        return new Response(JSON.stringify({
          id: 'p001',
          tenantId: 'mysc',
          version: 1,
          updatedAt: '2026-06-09T00:00:00Z',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': 'req-legacy' },
        });
      }
      return new Response(JSON.stringify({ ok: false }), {
        status: 404,
        headers: { 'content-type': 'application/json', 'x-request-id': 'req-miss' },
      });
    }));

    const client = createPlatformApiClient({
      PROD: 'true',
      VITE_PLATFORM_API_ENABLED: 'true',
      VITE_PLATFORM_API_BASE_URL: 'https://java-api.example.run.app',
      VITE_PLATFORM_LEGACY_BFF_BASE_URL: 'https://legacy-bff.example.app',
    });

    await fetchWeeklyExpenseStatusesViaBff({
      tenantId: 'mysc',
      actor: { uid: 'viewer-1', role: 'viewer' },
      projectId: 'p-cashflow',
      client,
    });
    await upsertProjectViaBff({
      tenantId: 'mysc',
      actor: { uid: 'admin-1', role: 'admin' },
      project: { id: 'p001', name: 'Project 1' },
      client,
    });

    expect(calls[0]).toBe('https://java-api.example.run.app/api/v1/weekly-expenses/p-cashflow/statuses');
    expect(calls[1]).toBe('https://legacy-bff.example.app/api/v1/projects');
    vi.unstubAllGlobals();
  });

  it('normalizes actor shape', () => {
    expect(toRequestActor({ uid: 'u001', email: 'a@x.com', role: 'admin' })).toEqual({
      id: 'u001',
      email: 'a@x.com',
      role: 'admin',
    });
  });

  it('does not pass id token through ordinary API actors', () => {
    expect(toRequestActor({ uid: 'u001', role: 'admin', idToken: 'token-abc' })).toEqual({
      id: 'u001',
      role: 'admin',
    });
  });

  it('calls contact update endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(),
      patch: vi.fn(async () => ({ data: { ok: true, contact: { id: 'ct_001', name: '홍길동', organization: 'MYSC', emails: ['person@example.com'], phones: [], score: 1 } } })),
      request: vi.fn(),
    });

    const result = await updateContactViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      contactId: 'ct_001',
      contact: {
        name: '홍길동',
        organization: 'MYSC',
        department: '',
        title: '',
        role: '',
        emails: ['person@example.com'],
        phones: [],
        website: '',
        address: '',
        memo: '수정',
      },
      client,
    });

    expect(client.patch).toHaveBeenCalledWith('/api/v1/contacts/ct_001', expect.objectContaining({
      tenantId: 'mysc',
      body: expect.objectContaining({ memo: '수정' }),
    }));
    expect(result.contact.id).toBe('ct_001');
  });

  it('calls project upsert endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({ data: { id: 'p001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-01' } })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await upsertProjectViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      project: { id: 'p001', name: 'Project 1' },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects', expect.objectContaining({
      tenantId: 'mysc',
      body: { id: 'p001', name: 'Project 1' },
    }));
    expect(result.version).toBe(1);
  });

  it('calls project trash and restore endpoints', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            id: 'p001',
            tenantId: 'mysc',
            version: 2,
            updatedAt: '2026-04-03T11:10:00.000Z',
            trashedAt: '2026-04-03T11:10:00.000Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: 'p001',
            tenantId: 'mysc',
            version: 3,
            updatedAt: '2026-04-03T11:12:00.000Z',
          },
        }),
      get: vi.fn(),
      request: vi.fn(),
    });

    const trashed = await trashProjectViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      projectId: 'p001',
      payload: { expectedVersion: 1, reason: '중복 등록' },
      client,
    });

    const restored = await restoreProjectViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      projectId: 'p001',
      payload: { expectedVersion: 2 },
      client,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/projects/p001/trash', expect.objectContaining({
      tenantId: 'mysc',
      body: { expectedVersion: 1, reason: '중복 등록' },
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/projects/p001/restore', expect.objectContaining({
      tenantId: 'mysc',
      body: { expectedVersion: 2 },
    }));
    expect(trashed.trashedAt).toBe('2026-04-03T11:10:00.000Z');
    expect(restored.version).toBe(3);
  });

  it('calls ledger/transaction endpoints', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 'l001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-02' } })
        .mockResolvedValueOnce({ data: { id: 'tx001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-02', state: 'DRAFT' } }),
      get: vi.fn(),
      request: vi.fn(),
    });

    const ledger = await upsertLedgerViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      ledger: { id: 'l001', projectId: 'p001', name: 'main ledger' },
      client,
    });

    const tx = await upsertTransactionViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transaction: { id: 'tx001', projectId: 'p001', ledgerId: 'l001', counterparty: 'vendor' },
      client,
    });

    expect(ledger.id).toBe('l001');
    expect(tx.state).toBe('DRAFT');
  });

  it('calls transaction state endpoint with expected version', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(async () => ({
        data: { id: 'tx001', state: 'APPROVED', rejectedReason: null, version: 2, updatedAt: '2026-01-02' },
      })),
    });

    const result = await changeTransactionStateViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      newState: 'APPROVED',
      expectedVersion: 1,
      client,
    });

    expect(client.request).toHaveBeenCalledWith('/api/v1/transactions/tx001/state', expect.objectContaining({
      method: 'PATCH',
      tenantId: 'mysc',
      body: { newState: 'APPROVED', expectedVersion: 1, reason: undefined },
    }));
    expect(result.state).toBe('APPROVED');
  });

  it('calls comment/evidence endpoints', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 'c001', transactionId: 'tx001', version: 1, createdAt: '2026-01-02' } })
        .mockResolvedValueOnce({ data: { id: 'ev001', transactionId: 'tx001', version: 1, uploadedAt: '2026-01-02' } }),
      get: vi.fn(),
      request: vi.fn(),
    });

    const comment = await addCommentViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      comment: { content: 'hello' },
      client,
    });

    const evidence = await addEvidenceViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      evidence: {
        fileName: 'invoice.pdf',
        fileType: 'application/pdf',
        fileSize: 123,
        category: '세금계산서',
      },
      client,
    });

    expect(comment.id).toBe('c001');
    expect(evidence.id).toBe('ev001');
  });

  it('fetches auth governance users through the bff client', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          items: [{ identityKey: 'jslee@mysc.co.kr', email: 'jslee@mysc.co.kr', driftFlags: ['missing_auth'] }],
          summary: {
            total: 1,
            needsDeepSync: 1,
            missingAuth: 1,
            missingCanonicalMember: 0,
            duplicateMemberDocs: 0,
            bootstrapCandidates: 1,
          },
        },
      })),
      request: vi.fn(),
    });

    const response = await fetchAuthGovernanceUsersViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-admin', role: 'admin', idToken: 'token-1' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/admin/auth-governance/users', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-admin', role: 'admin' }),
    }));
    expect(response.summary.total).toBe(1);
  });

  it('posts a deep sync request for an auth governance user', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          identityKey: 'jslee@mysc.co.kr',
          email: 'jslee@mysc.co.kr',
          canonicalDocId: 'uid-jslee',
          role: 'admin',
          mirroredLegacyCount: 1,
          claimsUpdated: true,
          updatedAt: '2026-04-13T06:30:00.000Z',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const response = await deepSyncAuthGovernanceUserViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-admin', role: 'admin', idToken: 'token-1' },
      identityKey: 'jslee@mysc.co.kr',
      role: 'admin',
      reason: 'cashflow export alignment',
      client,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/admin/auth-governance/users/jslee%40mysc.co.kr/deep-sync',
      expect.objectContaining({
        body: {
          role: 'admin',
          reason: 'cashflow export alignment',
        },
      }),
    );
    expect(response.claimsUpdated).toBe(true);
  });

  it('reads weekly cashflow through the BFF snapshot endpoint without client-side totals in the request', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          projectId: 'p-cashflow',
          projection: [],
          actual: [],
          readModel: {
            months: [
              {
                yearMonth: '2026-06',
                projection: {
                  rowTotals: { DIRECT_COST_OUT: 3000000 },
                  weeks: [
                    {
                      weekNo: 1,
                      amounts: { DIRECT_COST_OUT: 3000000 },
                      totalIn: 0,
                      totalOut: 3000000,
                      net: -3000000,
                      weekIn: 0,
                      weekOut: 3000000,
                    },
                  ],
                  monthTotals: { totalIn: 0, totalOut: 3000000, net: -3000000 },
                },
                actual: {
                  rowTotals: {},
                  weeks: [],
                  monthTotals: { totalIn: 0, totalOut: 0, net: 0 },
                },
              },
            ],
          },
        },
      })),
      request: vi.fn(),
    });

    const snapshot = await fetchWeeklyExpenseCashflowViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-finance', role: 'finance', idToken: 'token-1' },
      projectId: 'p-cashflow',
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/cashflow/p-cashflow', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-finance', role: 'finance' }),
      timeoutMs: 12000,
    }));
    const cashflowGetOptions = (client.get.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1];
    expect(cashflowGetOptions).not.toHaveProperty('body');
    expect(snapshot.readModel?.months[0].projection.monthTotals.net).toBe(-3000000);
  });

  it('exports cashflow audit output through the Java weekly audit-export route', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect(url).toBe('http://127.0.0.1:8787/api/v1/weekly-expenses/p-cashflow/audit-export');
      const headers = init?.headers as Headers;
      expect(headers.get('authorization')).toBeNull();
      expect(init?.credentials).toBe('include');
      expect(headers.get('x-tenant-id')).toBe('mysc');
      expect(headers.get('x-actor-id')).toBe('u-finance');
      expect(JSON.parse(String(init?.body))).toEqual({
        idempotencyKey: 'audit-export-key-1',
        format: 'CSV',
        includeAuditSummary: true,
      });
      return new Response(JSON.stringify({
        ok: true,
        artifactType: 'CSV',
        fileName: 'p-cashflow-weekly-expense-audit.csv',
        content: 'section,projectId\nprojection,p-cashflow\n',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', fetchImpl);
    try {
      const result = await exportCashflowWorkbookViaBff({
        tenantId: 'mysc',
        idempotencyKey: 'audit-export-key-1',
        actor: { uid: 'u-finance', role: 'finance', idToken: 'token-export' },
        body: {
          scope: 'single',
          projectId: 'p-cashflow',
          startYearMonth: '2026-06',
          endYearMonth: '2026-06',
          variant: 'single-project',
        },
      });

      expect(result.fileName).toBe('p-cashflow-weekly-expense-audit.csv');
      expect(await result.blob.text()).toContain('projection,p-cashflow');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('sends weekly projection idempotency in the Java request body', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          commandName: 'weeklyExpense.projection.upsert',
          savedLineCount: 1,
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    await upsertWeeklyExpenseProjectionViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-finance', role: 'finance' },
      projectId: 'p-cashflow',
      idempotencyKey: 'projection-key-1',
      lines: [
        { yearMonth: '2026-06', weekNo: 1, cashflowLine: '사업비', amount: 3000000 },
      ],
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/cashflow/p-cashflow/projection', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-finance', role: 'finance' }),
      body: {
        idempotencyKey: 'projection-key-1',
        lines: [
          { yearMonth: '2026-06', weekNo: 1, cashflowLine: '사업비', amount: 3000000 },
        ],
      },
      retries: 0,
      timeoutMs: 12000,
    }));
  });

  it('sends weekly submit and close commands through the same typed BFF options shape', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.submitWeek',
            projectId: 'p-cashflow',
            yearMonth: '2026-06',
            weekNo: 1,
            state: 'submitted',
            auditId: 'audit-submit-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.closeWeek',
            projectId: 'p-cashflow',
            yearMonth: '2026-06',
            weekNo: 1,
            state: 'closed',
            auditId: 'audit-close-1',
          },
        }),
      get: vi.fn(),
      request: vi.fn(),
    });

    await submitWeeklyExpenseWeekViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm', idToken: 'token-submit' },
      projectId: 'p-cashflow',
      yearMonth: '2026-06',
      weekNo: 1,
      idempotencyKey: 'submit-key-1',
      client,
    });

    await closeWeeklyExpenseWeekViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-finance', role: 'finance', idToken: 'token-close' },
      projectId: 'p-cashflow',
      yearMonth: '2026-06',
      weekNo: 1,
      idempotencyKey: 'close-key-1',
      client,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/weekly-expenses/p-cashflow/submit', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-pm', role: 'pm' }),
      body: { idempotencyKey: 'submit-key-1', yearMonth: '2026-06', weekNo: 1 },
      idempotencyKey: 'submit-key-1',
      retries: 0,
      timeoutMs: 12000,
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/weekly-expenses/p-cashflow/close', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-finance', role: 'finance' }),
      body: { idempotencyKey: 'close-key-1', yearMonth: '2026-06', weekNo: 1 },
      idempotencyKey: 'close-key-1',
      retries: 0,
      timeoutMs: 12000,
    }));
    expect(client.post.mock.calls[1]).toHaveLength(2);
  });

  it('fetches weekly status read model from the Java weekly API channel', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          projectId: 'p-cashflow',
          statuses: [
            {
              id: 'p-cashflow-2026-06-w1',
              projectId: 'p-cashflow',
              yearMonth: '2026-06',
              weekNo: 1,
              state: 'closed',
              pmSubmitted: true,
              submittedBy: 'u-pm',
              submittedAt: '2026-06-08T01:00:00Z',
              adminClosed: true,
              closedBy: 'u-finance',
              closedAt: '2026-06-08T02:00:00Z',
              updatedAt: '2026-06-08T02:00:00Z',
            },
          ],
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchWeeklyExpenseStatusesViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-viewer', role: 'viewer', idToken: 'token-status' },
      projectId: 'p-cashflow',
      client,
    });

    expect(result.statuses[0]?.state).toBe('closed');
    expect(client.get).toHaveBeenCalledWith('/api/v1/weekly-expenses/p-cashflow/statuses', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-viewer', role: 'viewer' }),
      timeoutMs: 12000,
    }));
  });

  it('sends weekly expense copy as a server clipboard command', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          commandName: 'weeklyExpense.cells.copy',
          projectId: 'p-cells',
          sheetId: 'sheet-1',
          sheetKey: 'default',
          sheetVersion: 4,
          touchedRows: [0],
          touchedCellCount: 2,
          cellIssues: [],
          actualDelta: [],
          clipboard: {
            operationType: 'COPY',
            depth: 'DEEP',
            sourceSelection: { startRow: 0, startColumn: 3, endRow: 0, endColumn: 4 },
            rowCount: 1,
            columnCount: 2,
            cells: [],
          },
          auditId: 'audit-copy-1',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await copyWeeklyExpenseCellsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm', idToken: 'token-copy' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'copy-key-1',
      payload: {
        expectedSheetVersion: 4,
        startRow: 0,
        startColumn: 3,
        endRow: 0,
        endColumn: 4,
        depth: 'DEEP',
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/weekly-expenses/p-cells/sheets/default/commands/copy', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-pm', role: 'pm' }),
      body: {
        idempotencyKey: 'copy-key-1',
        expectedSheetVersion: 4,
        startRow: 0,
        startColumn: 3,
        endRow: 0,
        endColumn: 4,
        depth: 'DEEP',
      },
      idempotencyKey: 'copy-key-1',
      retries: 0,
      timeoutMs: 12000,
    }));
    expect(result.clipboard?.operationType).toBe('COPY');
    expect(result.actualDelta).toEqual([]);
  });

  it('sends weekly expense cell and row commands through named Java ORM endpoints', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.cell.patch',
            projectId: 'p-cells',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 5,
            touchedRows: [0],
            touchedCellCount: 1,
            cellIssues: [],
            actualDelta: [],
            clipboard: null,
            auditId: 'audit-patch-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.cells.paste',
            projectId: 'p-cells',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 6,
            touchedRows: [1],
            touchedCellCount: 2,
            cellIssues: [],
            actualDelta: [{ yearMonth: '2026-06', weekNo: 1, cashflowLine: '사업비', amount: 3000 }],
            clipboard: null,
            auditId: 'audit-paste-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.cells.cut',
            projectId: 'p-cells',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 7,
            touchedRows: [1],
            touchedCellCount: 1,
            cellIssues: [],
            actualDelta: [],
            clipboard: { operationType: 'CUT', depth: 'SHALLOW', sourceSelection: { startRow: 1, startColumn: 13, endRow: 1, endColumn: 13 }, rowCount: 1, columnCount: 1, cells: [] },
            auditId: 'audit-cut-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.row.insert',
            projectId: 'p-cells',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 8,
            touchedRows: [2],
            rowVersions: [{ rowIndex: 2, rowVersion: 0 }],
            affectedRowCount: 1,
            cellIssues: [],
            actualDelta: [],
            auditId: 'audit-insert-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.row.delete',
            projectId: 'p-cells',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 9,
            touchedRows: [2],
            rowVersions: [],
            affectedRowCount: 1,
            cellIssues: [],
            actualDelta: [],
            auditId: 'audit-delete-1',
          },
        }),
      get: vi.fn(),
      request: vi.fn(),
    });

    await patchWeeklyExpenseCellsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'patch-key-1',
      payload: {
        expectedSheetVersion: 4,
        cells: [{ rowIndex: 0, columnIndex: 13, rawValue: '3000', userEdited: true }],
      },
      client,
    });
    await pasteWeeklyExpenseCellsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'paste-key-1',
      payload: {
        expectedSheetVersion: 5,
        anchorRow: 1,
        anchorColumn: 13,
        rowCount: 1,
        columnCount: 2,
        depth: 'SHALLOW',
        cells: [
          { relativeRow: 0, relativeColumn: 0, rawValue: '1000' },
          { relativeRow: 0, relativeColumn: 1, rawValue: '2000' },
        ],
      },
      client,
    });
    await cutWeeklyExpenseCellsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'cut-key-1',
      payload: {
        expectedSheetVersion: 6,
        startRow: 1,
        startColumn: 13,
        endRow: 1,
        endColumn: 13,
        depth: 'SHALLOW',
      },
      client,
    });
    await insertWeeklyExpenseRowsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'insert-key-1',
      payload: { expectedSheetVersion: 7, startRow: 2, rowCount: 1 },
      client,
    });
    await deleteWeeklyExpenseRowsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-cells',
      sheetKey: 'default',
      idempotencyKey: 'delete-key-1',
      payload: {
        expectedSheetVersion: 8,
        startRow: 2,
        rowCount: 1,
        expectedRowVersions: [{ rowIndex: 2, rowVersion: 1 }],
      },
      client,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/weekly-expenses/p-cells/sheets/default/commands/cell-patch', expect.objectContaining({
      idempotencyKey: 'patch-key-1',
      body: {
        idempotencyKey: 'patch-key-1',
        expectedSheetVersion: 4,
        cells: [{ rowIndex: 0, columnIndex: 13, rawValue: '3000', userEdited: true }],
      },
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/weekly-expenses/p-cells/sheets/default/commands/paste', expect.objectContaining({
      idempotencyKey: 'paste-key-1',
      body: expect.objectContaining({ idempotencyKey: 'paste-key-1', rowCount: 1, columnCount: 2, depth: 'SHALLOW' }),
    }));
    expect(client.post).toHaveBeenNthCalledWith(3, '/api/v1/weekly-expenses/p-cells/sheets/default/commands/cut', expect.objectContaining({
      idempotencyKey: 'cut-key-1',
      body: expect.objectContaining({ idempotencyKey: 'cut-key-1', startRow: 1, endColumn: 13, depth: 'SHALLOW' }),
    }));
    expect(client.post).toHaveBeenNthCalledWith(4, '/api/v1/weekly-expenses/p-cells/sheets/default/commands/row-insert', expect.objectContaining({
      idempotencyKey: 'insert-key-1',
      body: { idempotencyKey: 'insert-key-1', expectedSheetVersion: 7, startRow: 2, rowCount: 1 },
    }));
    expect(client.post).toHaveBeenNthCalledWith(5, '/api/v1/weekly-expenses/p-cells/sheets/default/commands/row-delete', expect.objectContaining({
      idempotencyKey: 'delete-key-1',
      body: {
        idempotencyKey: 'delete-key-1',
        expectedSheetVersion: 8,
        startRow: 2,
        rowCount: 1,
        expectedRowVersions: [{ rowIndex: 2, rowVersion: 1 }],
      },
    }));
    for (const [, options] of client.post.mock.calls) {
      expect(options.body).toHaveProperty('idempotencyKey');
      expect(options).toMatchObject({
        tenantId: 'mysc',
        actor: expect.objectContaining({ id: 'u-pm', role: 'pm' }),
        retries: 0,
      });
    }
  });

  it('sends bank statement import as staging only and applies only selected import line ids', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.bankStatement.importBatch',
            projectId: 'p-bank',
            batchId: 'batch-1',
            stagedLineCount: 2,
            duplicateLineCount: 0,
            lines: [
              { id: 'line-1', lineIndex: 0, sourceLineKey: 'src-1', status: 'staged', signedAmount: -1000 },
              { id: 'line-2', lineIndex: 1, sourceLineKey: 'src-2', status: 'staged', signedAmount: -2000 },
            ],
            auditId: 'audit-import-1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            ok: true,
            commandName: 'weeklyExpense.bankStatement.applyItems',
            projectId: 'p-bank',
            sheetId: 'sheet-1',
            sheetKey: 'default',
            sheetVersion: 1,
            appliedLineCount: 1,
            touchedRows: [0],
            cellIssues: [],
            actualDelta: [{ yearMonth: '2026-06', weekNo: 1, cashflowLine: '사업비', amount: 1000 }],
            auditId: 'audit-apply-1',
          },
        }),
      get: vi.fn(),
      request: vi.fn(),
    });

    await importWeeklyExpenseBankStatementBatchViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-bank',
      idempotencyKey: 'import-key-1',
      payload: {
        uploadName: 'bank.xlsx',
        columns: ['거래일시', '금액'],
        lines: [
          {
            lineIndex: 0,
            sourceLineKey: 'src-1',
            transactionDate: '2026-06-01',
            counterparty: '거래처1',
            memo: '선택',
            signedAmount: -1000,
            balanceAfter: 9000,
            rawCells: ['2026-06-01', '-1000'],
          },
          {
            lineIndex: 1,
            sourceLineKey: 'src-2',
            transactionDate: '2026-06-02',
            counterparty: '거래처2',
            memo: '미선택',
            signedAmount: -2000,
            balanceAfter: 7000,
            rawCells: ['2026-06-02', '-2000'],
          },
        ],
      },
      client,
    });

    await applyWeeklyExpenseBankStatementItemsViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-bank',
      idempotencyKey: 'apply-key-1',
      payload: {
        sheetKey: 'default',
        items: [
          {
            importLineId: 'line-1',
            cells: [
              { columnIndex: 3, rawValue: '2026-06-W1', userEdited: true },
              { columnIndex: 8, rawValue: '사업비', userEdited: true },
            ],
          },
        ],
      },
      client,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/weekly-expenses/p-bank/bank-statements/import-batch', expect.objectContaining({
      tenantId: 'mysc',
      idempotencyKey: 'import-key-1',
      body: expect.objectContaining({
        idempotencyKey: 'import-key-1',
        lines: expect.arrayContaining([
          expect.objectContaining({ sourceLineKey: 'src-1' }),
          expect.objectContaining({ sourceLineKey: 'src-2' }),
        ]),
      }),
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/weekly-expenses/p-bank/bank-statements/apply-items', expect.objectContaining({
      tenantId: 'mysc',
      idempotencyKey: 'apply-key-1',
      body: {
        idempotencyKey: 'apply-key-1',
        sheetKey: 'default',
        items: [
          {
            importLineId: 'line-1',
            cells: [
              { columnIndex: 3, rawValue: '2026-06-W1', userEdited: true },
              { columnIndex: 8, rawValue: '사업비', userEdited: true },
            ],
          },
        ],
      },
    }));
    expect(client.post.mock.calls[1][1].body.items).toHaveLength(1);
    expect(client.post.mock.calls[1][1].body.items[0].importLineId).toBe('line-1');
  });

  it('reads bank statement staged candidates through the BFF without a request body', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          ok: true,
          projectId: 'p-bank',
          status: 'staged',
          lines: [
            {
              id: 'line-1',
              batchId: 'batch-1',
              uploadName: 'bank.xlsx',
              batchStatus: 'staged',
              batchCreatedBy: 'u-pm',
              batchCreatedAt: '2026-06-08T00:00:00Z',
              lineIndex: 0,
              sourceLineKey: 'src-1',
              transactionDate: '2026-06-01',
              counterparty: '거래처1',
              memo: '선택 후보',
              signedAmount: -1000,
              balanceAfter: 9000,
              rawCells: ['2026-06-01', '-1000'],
              status: 'staged',
            },
          ],
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchWeeklyExpenseBankStatementImportLinesViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-pm', role: 'pm' },
      projectId: 'p-bank',
      status: 'staged',
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/weekly-expenses/p-bank/bank-statements/import-lines?status=staged', expect.objectContaining({
      tenantId: 'mysc',
      actor: expect.objectContaining({ id: 'u-pm', role: 'pm' }),
      timeoutMs: 12000,
    }));
    const importLinesGetOptions = (client.get.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0][1];
    expect(importLinesGetOptions).not.toHaveProperty('body');
    expect(result.lines[0].rawCells).toEqual(['2026-06-01', '-1000']);
  });

  it('calls project request contract analysis endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          provider: 'anthropic',
          model: 'claude-sonnet',
          summary: '초안 생성',
          warnings: ['사람 확인 필요'],
          nextActions: ['담당팀은 직접 선택하세요.'],
          extractedAt: '2026-03-16T09:00:00.000Z',
          fields: {
            officialContractName: { value: '뷰티풀 커넥트 운영 계약', confidence: 'high', evidence: '사업명: 뷰티풀 커넥트 운영 계약' },
            suggestedProjectName: { value: '뷰티풀커넥트', confidence: 'high', evidence: '사업명' },
            clientOrg: { value: '아모레퍼시픽재단', confidence: 'high', evidence: '발주기관' },
            projectPurpose: { value: '청년 창업가의 지역 연결 지원', confidence: 'medium', evidence: '사업 목적' },
            description: { value: '', confidence: 'low', evidence: '' },
            contractStart: { value: '2026-03-01', confidence: 'high', evidence: '계약기간' },
            contractEnd: { value: '2026-12-31', confidence: 'high', evidence: '계약기간' },
            contractAmount: { value: 120000000, confidence: 'high', evidence: '총 계약금액' },
            salesVatAmount: { value: 12000000, confidence: 'medium', evidence: '부가세' },
          },
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await analyzeProjectRequestContractViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      fileName: 'contract.pdf',
      documentText: '사업명: 뷰티풀 커넥트 운영 계약',
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/project-requests/contract/analyze', expect.objectContaining({
      tenantId: 'mysc',
      body: {
        fileName: 'contract.pdf',
        documentText: '사업명: 뷰티풀 커넥트 운영 계약',
      },
    }));
    expect(result.fields.officialContractName.value).toBe('뷰티풀 커넥트 운영 계약');
    expect(result.fields.contractAmount.value).toBe(120000000);
  });

  it('calls project request contract upload endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          path: 'orgs/mysc/project-request-contracts/u001/contract.pdf',
          name: 'contract.pdf',
          downloadURL: 'https://example.com/contract.pdf',
          size: 1234,
          contentType: 'application/pdf',
          uploadedAt: '2026-03-16T10:00:00.000Z',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await uploadProjectRequestContractViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      upload: {
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        fileSize: 1234,
        contentBase64: 'ZmFrZS1wZGY=',
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/project-requests/contract/upload', expect.objectContaining({
      tenantId: 'mysc',
      body: {
        fileName: 'contract.pdf',
        mimeType: 'application/pdf',
        fileSize: 1234,
        contentBase64: 'ZmFrZS1wZGY=',
      },
    }));
    expect(result.downloadURL).toContain('contract.pdf');
  });

  it('calls project request contract process endpoint with binary body', async () => {
    const file = new File(['pdf-bytes'], '계약서 샘플.pdf', { type: 'application/pdf' });
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(async () => ({
        data: {
          contractDocument: {
            path: 'orgs/mysc/project-request-contracts/u001/contract.pdf',
            name: 'contract.pdf',
            downloadURL: 'https://example.com/contract.pdf',
            size: 1234,
            contentType: 'application/pdf',
            uploadedAt: '2026-03-16T10:00:00.000Z',
          },
          analysis: {
            provider: 'heuristic',
            model: 'deterministic-fallback',
            summary: 'summary',
            warnings: [],
            nextActions: [],
            extractedAt: '2026-03-16T10:00:00.000Z',
            fields: {
              officialContractName: { value: '공식 계약명', confidence: 'medium', evidence: '근거' },
              suggestedProjectName: { value: '계약명', confidence: 'medium', evidence: '근거' },
              clientOrg: { value: '', confidence: 'low', evidence: '' },
              projectPurpose: { value: '', confidence: 'low', evidence: '' },
              description: { value: '', confidence: 'low', evidence: '' },
              contractStart: { value: '', confidence: 'low', evidence: '' },
              contractEnd: { value: '', confidence: 'low', evidence: '' },
              contractAmount: { value: null, confidence: 'low', evidence: '' },
              salesVatAmount: { value: null, confidence: 'low', evidence: '' },
            },
          },
        },
      })),
    });

    const result = await processProjectRequestContractViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      file,
      client,
    });

    expect(client.request).toHaveBeenCalledWith('/api/v1/project-requests/contract/process', expect.objectContaining({
      method: 'POST',
      tenantId: 'mysc',
      body: file,
      headers: expect.objectContaining({
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('계약서 샘플.pdf'),
        'x-file-type': 'application/pdf',
      }),
    }));
    expect(result.analysis.fields.officialContractName.value).toBe('공식 계약명');
  });

  it('calls project registration notification endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          enabled: true,
          delivered: true,
          requestId: 'pr-123',
          projectId: 'p-123',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await notifyProjectRequestRegistrationViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      projectRequestId: 'pr-123',
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/project-requests/pr-123/notify-registration', expect.objectContaining({
      tenantId: 'mysc',
      body: {},
      idempotencyKey: 'project-request-registration-notify:pr-123',
    }));
    expect(result.delivered).toBe(true);
    expect(result.projectId).toBe('p-123');
  });

  it('calls project executive review endpoint with reason and reviewer metadata', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          projectId: 'p-123',
          requestId: 'pr-123',
          reviewStatus: 'REVISION_REJECTED',
          slackDelivered: true,
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await reviewProjectExecutiveStatusViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-admin', role: 'admin', idToken: 'token-abc' },
      projectId: 'p-123',
      review: {
        requestId: 'pr-123',
        reviewStatus: 'REVISION_REJECTED',
        reviewComment: '예산 다시 올려 주세요',
        reviewerName: '임원A',
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/p-123/executive-review', expect.objectContaining({
      tenantId: 'mysc',
      body: {
        requestId: 'pr-123',
        reviewStatus: 'REVISION_REJECTED',
        reviewComment: '예산 다시 올려 주세요',
        reviewerName: '임원A',
      },
    }));
    expect(result.reviewStatus).toBe('REVISION_REJECTED');
    expect(result.slackDelivered).toBe(true);
  });

  it('calls project executive review resubmission endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          projectId: 'p-123',
          requestId: 'pr-123',
          reviewStatus: 'PENDING',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const { resubmitProjectExecutiveReviewViaBff } = await import('./platform-bff-client');
    const result = await resubmitProjectExecutiveReviewViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u-admin', role: 'admin', idToken: 'token-abc' },
      projectId: 'p-123',
      payload: {
        requestId: 'pr-123',
        reviewComment: '계약서 보완 후 재제출',
        reviewerName: '변민욱',
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/p-123/executive-review/resubmit', expect.objectContaining({
      tenantId: 'mysc',
      body: {
        requestId: 'pr-123',
        reviewComment: '계약서 보완 후 재제출',
        reviewerName: '변민욱',
      },
    }));
    expect(result.reviewStatus).toBe('PENDING');
  });

  it('calls evidence drive provision/sync endpoints', async () => {
    const client = asMockClient({
      post: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            projectId: 'p001',
            folderId: 'fld-project',
            folderName: 'Project Root',
            webViewLink: 'https://drive.google.com/drive/folders/fld-project',
            sharedDriveId: 'shared-001',
            version: 2,
            updatedAt: '2026-03-11T10:00:00.000Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            projectId: 'p001',
            folderId: 'fld-project',
            folderName: 'Project Root',
            webViewLink: 'https://drive.google.com/drive/folders/fld-project',
            sharedDriveId: 'shared-001',
            version: 3,
            updatedAt: '2026-03-11T10:01:30.000Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            transactionId: 'tx001',
            projectId: 'p001',
            folderId: 'fld-tx',
            folderName: '20260311_회의비_다과비_tx001',
            webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
            sharedDriveId: 'shared-001',
            evidenceCount: 2,
            evidenceCompletedDesc: '세금계산서, 입금확인서',
            evidenceAutoListedDesc: '세금계산서, 입금확인서',
            evidencePendingDesc: null,
            supportPendingDocs: null,
            evidenceMissing: [],
            evidenceStatus: 'COMPLETE',
            lastSyncedAt: '2026-03-11T10:02:00.000Z',
            version: 4,
            updatedAt: '2026-03-11T10:02:00.000Z',
          },
        }),
      get: vi.fn(),
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            transactionId: 'tx001',
            projectId: 'p001',
            projectFolderId: 'fld-project',
            projectFolderName: 'Project Root',
            folderId: 'fld-tx',
            folderName: '20260311_회의비_다과비_tx001',
            webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
            sharedDriveId: 'shared-001',
            syncStatus: 'LINKED',
            version: 3,
            updatedAt: '2026-03-11T10:01:00.000Z',
          },
        })
        .mockResolvedValueOnce({
          data: {
            transactionId: 'tx001',
            projectId: 'p001',
            folderId: 'fld-tx',
            folderName: '20260311_회의비_다과비_tx001',
            webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
            sharedDriveId: 'shared-001',
            evidenceCount: 2,
            evidenceCompletedDesc: '세금계산서, 입금확인서',
            evidenceAutoListedDesc: '세금계산서, 입금확인서',
            evidencePendingDesc: null,
            supportPendingDocs: null,
            evidenceMissing: [],
            evidenceStatus: 'COMPLETE',
            lastSyncedAt: '2026-03-11T10:02:00.000Z',
            version: 4,
            updatedAt: '2026-03-11T10:02:00.000Z',
          },
        }),
    });

    const projectRoot = await provisionProjectEvidenceDriveRootViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      projectId: 'p001',
      client,
    });

    const txFolder = await provisionTransactionEvidenceDriveViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      client,
    });

    const linkedRoot = await linkProjectEvidenceDriveRootViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      projectId: 'p001',
      value: 'https://drive.google.com/drive/folders/fld-project',
      client,
    });

    const syncResult = await syncTransactionEvidenceDriveViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      client,
    });

    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/projects/p001/evidence-drive/root/provision', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(client.request).toHaveBeenNthCalledWith(1, '/api/v1/transactions/tx001/evidence-drive/provision', expect.objectContaining({
      tenantId: 'mysc',
      method: 'POST',
      retries: 0,
      timeoutMs: 15000,
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/projects/p001/evidence-drive/root/link', expect.objectContaining({
      tenantId: 'mysc',
      body: { value: 'https://drive.google.com/drive/folders/fld-project' },
    }));
    expect(client.request).toHaveBeenNthCalledWith(2, '/api/v1/transactions/tx001/evidence-drive/sync', expect.objectContaining({
      tenantId: 'mysc',
      method: 'POST',
      retries: 0,
      timeoutMs: 20000,
    }));
    expect(projectRoot.folderId).toBe('fld-project');
    expect(txFolder.syncStatus).toBe('LINKED');
    expect(linkedRoot.folderName).toBe('Project Root');
    expect(syncResult.evidenceStatus).toBe('COMPLETE');
  });

  it('uploads an evidence file through the drive upload endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(async () => ({
        data: {
          transactionId: 'tx001',
          projectId: 'p001',
          folderId: 'fld-tx',
          folderName: '20260311_회의비_다과비_tx001',
          driveFileId: 'drv-file-001',
          fileName: 'ZOOM invoice March.pdf',
          webViewLink: 'https://drive.google.com/file/d/drv-file-001/view',
          category: 'ZOOM invoice',
          parserCategory: 'ZOOM invoice',
          parserConfidence: 0.92,
          evidenceCount: 1,
          evidenceCompletedDesc: 'ZOOM invoice',
          evidenceAutoListedDesc: 'ZOOM invoice',
          evidencePendingDesc: null,
          supportPendingDocs: null,
          evidenceMissing: [],
          evidenceStatus: 'COMPLETE',
          lastSyncedAt: '2026-03-11T11:00:00.000Z',
          version: 5,
          updatedAt: '2026-03-11T11:00:00.000Z',
        },
      })),
    });

    const result = await uploadTransactionEvidenceDriveViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'admin' },
      transactionId: 'tx001',
      upload: {
        fileName: 'ZOOM invoice March.pdf',
        originalFileName: 'zoom_3month_raw.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        contentBase64: 'ZmFrZS1wZGY=',
        category: 'ZOOM invoice',
      },
      client,
    });

    expect(client.request).toHaveBeenCalledWith('/api/v1/transactions/tx001/evidence-drive/upload', expect.objectContaining({
      tenantId: 'mysc',
      method: 'POST',
      retries: 0,
      timeoutMs: 30000,
      body: expect.objectContaining({
        fileName: 'ZOOM invoice March.pdf',
        originalFileName: 'zoom_3month_raw.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        category: 'ZOOM invoice',
      }),
    }));
    expect(result.driveFileId).toBe('drv-file-001');
    expect(result.evidenceCompletedDesc).toBe('ZOOM invoice');
  });

  it('posts evidence drive category overrides', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(async () => ({
        data: {
          transactionId: 'tx001',
          projectId: 'p001',
          folderId: 'fld-tx',
          folderName: '20260311_회의비_다과비_tx001',
          webViewLink: 'https://drive.google.com/drive/folders/fld-tx',
          sharedDriveId: 'drive-001',
          evidenceCount: 1,
          evidenceCompletedDesc: '세금계산서',
          evidenceAutoListedDesc: '세금계산서',
          evidencePendingDesc: null,
          supportPendingDocs: null,
          evidenceMissing: [],
          evidenceStatus: 'COMPLETE',
          lastSyncedAt: '2026-03-11T11:10:00.000Z',
          version: 6,
          updatedAt: '2026-03-11T11:10:00.000Z',
        },
      })),
    });

    const result = await overrideTransactionEvidenceDriveCategoriesViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm' },
      transactionId: 'tx001',
      overrides: {
        items: [{ driveFileId: 'drv-file-001', category: '세금계산서' }],
      },
      client,
    });

    expect(client.request).toHaveBeenCalledWith('/api/v1/transactions/tx001/evidence-drive/overrides', expect.objectContaining({
      method: 'POST',
      tenantId: 'mysc',
      body: {
        items: [{ driveFileId: 'drv-file-001', category: '세금계산서' }],
      },
    }));
    expect(result.evidenceCompletedDesc).toBe('세금계산서');
  });

  it('calls google sheet import preview endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          spreadsheetId: 'sheet-001',
          spreadsheetTitle: '주간 사업비 시트',
          selectedSheetName: '주간정산',
          availableSheets: [
            { sheetId: 0, title: '요약', index: 0 },
            { sheetId: 1, title: '주간정산', index: 1 },
          ],
          matrix: [
            ['작성자', '거래일시', '지급처'],
            ['홍길동', '2026-03-12', '카페 메리'],
          ],
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const preview = await previewGoogleSheetImportViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', googleAccessToken: 'google-token-123' },
      projectId: 'p001',
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit#gid=1',
      sheetName: '주간정산',
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/p001/google-sheet-import/preview', expect.objectContaining({
      headers: {
        'x-google-access-token': 'google-token-123',
      },
      body: {
        value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit#gid=1',
        sheetName: '주간정산',
      },
      timeoutMs: 20000,
    }));
    expect(preview.selectedSheetName).toBe('주간정산');
  });

  it('calls google sheet import analysis endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          summary: '사용내역 탭으로 보입니다.',
          confidence: 'high',
          likelyTarget: 'expense_sheet',
          usageTips: ['상단 헤더를 먼저 확인하세요.'],
          warnings: ['2줄 헤더 여부를 확인하세요.'],
          nextActions: ['표본 3행을 먼저 검증하세요.'],
          suggestedMappings: [
            {
              sourceHeader: '입금합계 > 입금액',
              platformField: '입금합계/입금액',
              confidence: 'high',
              reason: '입금 금액 계열입니다.',
            },
          ],
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const analysis = await analyzeGoogleSheetImportViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm' },
      projectId: 'p001',
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: '사용내역',
      matrix: [
        ['작성자', '입금합계', '사업팀'],
        ['No.', '입금액', '지급처'],
      ],
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/p001/google-sheet-import/analyze', expect.objectContaining({
      body: {
        spreadsheetTitle: '2026 사업비 관리 시트',
        selectedSheetName: '사용내역',
        matrix: [
          ['작성자', '입금합계', '사업팀'],
          ['No.', '입금액', '지급처'],
        ],
      },
      timeoutMs: 25000,
    }));
    expect(analysis.likelyTarget).toBe('expense_sheet');
  });

  it('calls project sheet source upload endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          sourceType: 'usage',
          projectId: 'p001',
          sheetName: '사용내역',
          fileName: '환경AC.xlsx',
          storagePath: 'orgs/mysc/project-sheet-sources/p001/usage/123-환경AC.xlsx',
          downloadURL: 'https://example.com/source.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          uploadedAt: '2026-03-19T12:00:00.000Z',
          rowCount: 176,
          columnCount: 27,
          matchedColumns: ['작성자', '비목'],
          unmatchedColumns: ['정산증빙자료 부착완료 여부'],
          previewMatrix: [['작성자', '비목'], ['메리', '여비']],
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await uploadProjectSheetSourceViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm' },
      projectId: 'p001',
      upload: {
        sourceType: 'usage',
        sheetName: '사용내역',
        fileName: '환경AC.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 123456,
        contentBase64: 'ZmFrZS14bHN4',
        rowCount: 176,
        columnCount: 27,
        matchedColumns: ['작성자', '비목'],
        unmatchedColumns: ['정산증빙자료 부착완료 여부'],
        previewMatrix: [['작성자', '비목'], ['메리', '여비']],
        applyTarget: 'expense_sheet',
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/projects/p001/sheet-sources/upload', expect.objectContaining({
      tenantId: 'mysc',
      body: expect.objectContaining({
        sourceType: 'usage',
        sheetName: '사용내역',
        applyTarget: 'expense_sheet',
      }),
      timeoutMs: 45000,
    }));
    expect(result.sourceType).toBe('usage');
    expect(result.previewMatrix[1]).toEqual(['메리', '여비']);
  });

  it('normalizes nullable google sheet migration analysis arrays', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          summary: '사용내역 탭으로 보입니다.',
          confidence: 'high',
          likelyTarget: 'expense_sheet',
          usageTips: null,
          warnings: null,
          nextActions: null,
          suggestedMappings: null,
          headerPreview: null,
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const analysis = await analyzeGoogleSheetImportViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm' },
      projectId: 'p001',
      selectedSheetName: '사용내역',
      matrix: [
        ['작성자', '입금합계', '사업팀'],
        ['No.', '입금액', '지급처'],
      ],
      client,
    });

    expect(analysis.usageTips).toEqual([]);
    expect(analysis.warnings).toEqual([]);
    expect(analysis.nextActions).toEqual([]);
    expect(analysis.suggestedMappings).toEqual([]);
    expect(analysis.headerPreview).toEqual([]);
  });
});
