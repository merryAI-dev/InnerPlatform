import { describe, expect, it, vi } from 'vitest';
import {
  addCommentViaBff,
  addEvidenceViaBff,
  analyzeGoogleSheetImportViaBff,
  analyzeProjectRequestContractViaBff,
  changeTransactionStateViaBff,
  deepSyncAuthGovernanceUserViaBff,
  fetchPortalEntryContextViaBff,
  fetchPortalOnboardingContextViaBff,
  fetchPortalDashboardSummaryViaBff,
  fetchPortalPayrollSummaryViaBff,
  fetchPortalWeeklyExpensesSummaryViaBff,
  fetchPortalBankStatementsSummaryViaBff,
  fetchAuthGovernanceUsersViaBff,
  linkProjectEvidenceDriveRootViaBff,
  notifyProjectRequestRegistrationViaBff,
  overrideTransactionEvidenceDriveCategoriesViaBff,
  previewGoogleSheetImportViaBff,
  processProjectRequestContractViaBff,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  readPlatformApiRuntimeConfig,
  restoreProjectViaBff,
  syncTransactionEvidenceDriveViaBff,
  trashProjectViaBff,
  upsertPortalRegistrationViaBff,
  uploadProjectSheetSourceViaBff,
  uploadProjectRequestContractViaBff,
  toRequestActor,
  switchPortalSessionProjectViaBff,
  uploadTransactionEvidenceDriveViaBff,
  upsertLedgerViaBff,
  type PlatformApiClientLike,
  upsertProjectViaBff,
  upsertTransactionViaBff,
} from './platform-bff-client';

function asMockClient<T extends {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
}>(client: T): T & PlatformApiClientLike {
  return client as T & PlatformApiClientLike;
}

describe('platform-bff-client', () => {
  it('reads runtime config with defaults', () => {
    expect(readPlatformApiRuntimeConfig({})).toEqual({
      enabled: false,
      baseUrl: 'http://127.0.0.1:8787',
    });
  });

  it('falls back to the current browser origin when no API base is configured', () => {
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', {
      location: {
        origin: 'https://inner-platform.vercel.app',
        hostname: 'inner-platform.vercel.app',
      },
    });

    expect(readPlatformApiRuntimeConfig({})).toEqual({
      enabled: false,
      baseUrl: 'https://inner-platform.vercel.app',
    });

    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      vi.stubGlobal('window', previousWindow);
    }
  });

  it('prefers the current browser origin when the dev auth harness is enabled on localhost', () => {
    const previousWindow = globalThis.window;
    vi.stubGlobal('window', {
      location: {
        origin: 'http://localhost:4173',
        hostname: 'localhost',
      },
    });

    expect(readPlatformApiRuntimeConfig({
      VITE_DEV_AUTH_HARNESS_ENABLED: 'true',
      VITE_PLATFORM_API_BASE_URL: 'http://127.0.0.1:8787',
    })).toEqual({
      enabled: false,
      baseUrl: 'http://localhost:4173',
    });

    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      vi.stubGlobal('window', previousWindow);
    }
  });

  it('normalizes actor shape', () => {
    expect(toRequestActor({ uid: 'u001', email: 'a@x.com', role: 'admin' })).toEqual({
      id: 'u001',
      email: 'a@x.com',
      role: 'admin',
    });
  });

  it('passes id token when provided', () => {
    expect(toRequestActor({ uid: 'u001', role: 'admin', idToken: 'token-abc' })).toEqual({
      id: 'u001',
      role: 'admin',
      idToken: 'token-abc',
    });
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

  it('calls portal entry context endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          registrationState: 'registered',
          activeProjectId: 'p001',
          projects: [
            {
              id: 'p001',
              name: 'Project 1',
              status: 'IN_PROGRESS',
              clientOrg: 'MYSC',
              managerName: '보람',
              department: 'AXR',
            },
          ],
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalEntryContextViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/entry-context', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.activeProjectId).toBe('p001');
    expect(result.projects).toHaveLength(1);
  });

  it('calls portal dashboard summary endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          project: { id: 'p001', name: 'Project 1', managerName: '보람' },
          summary: {
            payrollRiskCount: 1,
            visibleProjects: 3,
          },
          surface: {
            currentWeekLabel: '3주차',
            projection: { label: '작성됨', detail: '3주차 · 제출 완료', latestUpdatedAt: '2026-04-16T09:00:00.000Z' },
            expense: { label: '지급 여력 양호', detail: '3주차 · 지급 여력 양호', tone: 'success' },
            visibleIssues: [],
          },
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalDashboardSummaryViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/dashboard-summary', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.summary.payrollRiskCount).toBe(1);
  });

  it('calls portal payroll summary endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          project: { id: 'p001', name: 'Project 1', managerName: '보람' },
          summary: {
            queueCount: 1,
            riskCount: 1,
            status: 'payment_unconfirmed',
          },
          schedule: { id: 'p001', dayOfMonth: 25, timezone: 'Asia/Seoul', noticeLeadBusinessDays: 3, active: true },
          currentRun: {
            id: 'p001-2026-04',
            projectId: 'p001',
            yearMonth: '2026-04',
            plannedPayDate: '2026-04-25',
            noticeDate: '2026-04-22',
            noticeLeadBusinessDays: 3,
            acknowledged: false,
            paidStatus: 'MISSING',
            currentBalance: null,
            worstBalance: null,
            status: 'payment_unconfirmed',
            statusReason: '지급일이 지났지만 아직 지급 확정이 기록되지 않았습니다.',
            dayBalances: [],
          },
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalPayrollSummaryViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/payroll-summary', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.summary.queueCount).toBe(1);
  });

  it('calls portal weekly-expenses summary endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          project: { id: 'p001', name: 'Project 1', managerName: '보람' },
          summary: {
            currentWeekLabel: '3주차',
            expenseReviewPendingCount: 2,
          },
          expenseSheet: { activeSheetId: 'default', activeSheetName: '기본 탭', sheetCount: 2, rowCount: 10 },
          bankStatement: { rowCount: 4, columnCount: 8, profile: 'general' },
          handoff: { canOpenWeeklyExpenses: true, canUseEvidenceWorkflow: false, nextPath: '/portal/bank-statements' },
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalWeeklyExpensesSummaryViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/weekly-expenses-summary', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.handoff.canOpenWeeklyExpenses).toBe(true);
  });

  it('calls portal bank-statements summary endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          project: { id: 'p001', name: 'Project 1', managerName: '보람' },
          bankStatement: { rowCount: 4, columnCount: 8, profile: 'general', lastSavedAt: '2026-04-16T09:00:00.000Z' },
          handoffContext: { ready: true, reason: '저장된 통장내역이 있습니다.', nextPath: '/portal/weekly-expenses' },
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalBankStatementsSummaryViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/bank-statements-summary', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.handoffContext.ready).toBe(true);
  });

  it('calls portal session project switch endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          activeProjectId: 'p002',
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await switchPortalSessionProjectViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      projectId: 'p002',
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/portal/session-project', expect.objectContaining({
      tenantId: 'mysc',
      body: { projectId: 'p002' },
    }));
    expect(result.activeProjectId).toBe('p002');
  });

  it('calls portal onboarding context endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(),
      get: vi.fn(async () => ({
        data: {
          registrationState: 'unregistered',
          activeProjectId: '',
          projects: [
            {
              id: 'p003',
              name: 'Project 3',
              status: 'CONTRACT_PENDING',
              clientOrg: 'MYSC',
              managerName: '데이나',
              department: 'AXR',
            },
          ],
        },
      })),
      request: vi.fn(),
    });

    const result = await fetchPortalOnboardingContextViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      client,
    });

    expect(client.get).toHaveBeenCalledWith('/api/v1/portal/onboarding-context', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(result.registrationState).toBe('unregistered');
    expect(result.projects[0]?.id).toBe('p003');
  });

  it('calls portal registration endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          registrationState: 'registered',
          activeProjectId: 'p003',
          projectIds: ['p003', 'p004'],
        },
      })),
      get: vi.fn(),
      request: vi.fn(),
    });

    const result = await upsertPortalRegistrationViaBff({
      tenantId: 'mysc',
      actor: { uid: 'u001', role: 'pm', idToken: 'token-abc' },
      registration: {
        name: '보람',
        email: 'boram@mysc.co.kr',
        role: 'pm',
        projectId: 'p003',
        projectIds: ['p003', 'p004'],
      },
      client,
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/portal/registration', expect.objectContaining({
      tenantId: 'mysc',
      body: {
        name: '보람',
        email: 'boram@mysc.co.kr',
        role: 'pm',
        projectId: 'p003',
        projectIds: ['p003', 'p004'],
      },
    }));
    expect(result.activeProjectId).toBe('p003');
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
      actor: expect.objectContaining({ id: 'u-admin', role: 'admin', idToken: 'token-1' }),
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
