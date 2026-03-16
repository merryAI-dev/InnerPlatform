import { describe, expect, it, vi } from 'vitest';
import {
  addCommentViaBff,
  addEvidenceViaBff,
  analyzeGoogleSheetImportViaBff,
  analyzeProjectRequestContractViaBff,
  changeTransactionStateViaBff,
  linkProjectEvidenceDriveRootViaBff,
  overrideTransactionEvidenceDriveCategoriesViaBff,
  previewGoogleSheetImportViaBff,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  readPlatformApiRuntimeConfig,
  syncTransactionEvidenceDriveViaBff,
  toRequestActor,
  uploadTransactionEvidenceDriveViaBff,
  upsertLedgerViaBff,
  upsertProjectViaBff,
  upsertTransactionViaBff,
} from './platform-bff-client';

describe('platform-bff-client', () => {
  it('reads runtime config with defaults', () => {
    expect(readPlatformApiRuntimeConfig({})).toEqual({
      enabled: false,
      baseUrl: 'http://127.0.0.1:8787',
    });
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
    const client = {
      post: vi.fn(async () => ({ data: { id: 'p001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-01' } })),
      get: vi.fn(),
      request: vi.fn(),
    };

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

  it('calls ledger/transaction endpoints', async () => {
    const client = {
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 'l001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-02' } })
        .mockResolvedValueOnce({ data: { id: 'tx001', tenantId: 'mysc', version: 1, updatedAt: '2026-01-02', state: 'DRAFT' } }),
      get: vi.fn(),
      request: vi.fn(),
    };

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
    const client = {
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(async () => ({
        data: { id: 'tx001', state: 'APPROVED', rejectedReason: null, version: 2, updatedAt: '2026-01-02' },
      })),
    };

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
    const client = {
      post: vi
        .fn()
        .mockResolvedValueOnce({ data: { id: 'c001', transactionId: 'tx001', version: 1, createdAt: '2026-01-02' } })
        .mockResolvedValueOnce({ data: { id: 'ev001', transactionId: 'tx001', version: 1, uploadedAt: '2026-01-02' } }),
      get: vi.fn(),
      request: vi.fn(),
    };

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

  it('calls project request contract analysis endpoint', async () => {
    const client = {
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
    };

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

  it('calls evidence drive provision/sync endpoints', async () => {
    const client = {
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
    };

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
    const client = {
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
    };

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
    const client = {
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
    };

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
    const client = {
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
    };

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
    const client = {
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
    };

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

  it('normalizes nullable google sheet migration analysis arrays', async () => {
    const client = {
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
    };

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
