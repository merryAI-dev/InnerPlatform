import { describe, expect, it, vi } from 'vitest';
import {
  addCommentViaBff,
  addEvidenceViaBff,
  changeTransactionStateViaBff,
  linkProjectEvidenceDriveRootViaBff,
  provisionProjectEvidenceDriveRootViaBff,
  provisionTransactionEvidenceDriveViaBff,
  readPlatformApiRuntimeConfig,
  syncTransactionEvidenceDriveViaBff,
  toRequestActor,
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
      request: vi.fn(),
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
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/transactions/tx001/evidence-drive/provision', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(client.post).toHaveBeenNthCalledWith(3, '/api/v1/projects/p001/evidence-drive/root/link', expect.objectContaining({
      tenantId: 'mysc',
      body: { value: 'https://drive.google.com/drive/folders/fld-project' },
    }));
    expect(client.post).toHaveBeenNthCalledWith(4, '/api/v1/transactions/tx001/evidence-drive/sync', expect.objectContaining({
      tenantId: 'mysc',
    }));
    expect(projectRoot.folderId).toBe('fld-project');
    expect(txFolder.syncStatus).toBe('LINKED');
    expect(linkedRoot.folderName).toBe('Project Root');
    expect(syncResult.evidenceStatus).toBe('COMPLETE');
  });
});
