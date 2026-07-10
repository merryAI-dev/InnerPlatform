import { describe, expect, it, vi } from 'vitest';
import {
  createProjectRequestContractStorageService,
  normalizeSafeFileName,
} from './project-request-contract-storage.mjs';

describe('project-request-contract-storage', () => {
  it('normalizes file names for storage paths', () => {
    expect(normalizeSafeFileName('   계약서   (2025)  최종본.pdf')).toBe('계약서_(2025)_최종본.pdf');
  });

  it('uploads a contract via injected storage bucket', async () => {
    const save = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn(() => ({ save })),
    };
    const storage = {
      bucket: vi.fn(() => bucket),
    };

    const service = createProjectRequestContractStorageService({
      projectId: 'mysc-bmp-14173451',
      bucketName: 'mysc-bmp-14173451.firebasestorage.app',
      storage,
    });

    const result = await service.uploadContract({
      tenantId: 'mysc',
      actorId: 'u001',
      fileName: 'contract.pdf',
      mimeType: 'application/pdf',
      fileSize: 16,
      contentBase64: Buffer.from('fake-pdf', 'utf8').toString('base64'),
    });

    expect(storage.bucket).toHaveBeenCalledWith('mysc-bmp-14173451.firebasestorage.app');
    expect(save).toHaveBeenCalled();
    expect(result.path).toContain('orgs/mysc/project-request-contracts/u001/');
    expect(result.downloadURL).toContain('firebasestorage.googleapis.com');
  });

  it('uploads a private draft attachment without a Firebase download token', async () => {
    const save = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn((path: string) => ({ path, save })),
    };
    const service = createProjectRequestContractStorageService({
      projectId: 'demo-bff-it',
      bucketName: 'demo-bff-it.firebasestorage.app',
      storage: { bucket: vi.fn(() => bucket) },
    });

    const result = await service.uploadDraftAttachment({
      tenantId: 'tenant-a',
      draftId: 'draft-a',
      attachmentId: 'attachment-a',
      fileName: ' 계약서 최종.pdf ',
      mimeType: 'application/pdf',
      buffer: Buffer.from('private-pdf'),
    });

    expect(result).toMatchObject({
      path: 'orgs/tenant-a/project-registration-drafts/draft-a/attachment-a-계약서_최종.pdf',
      name: '계약서 최종.pdf',
      size: Buffer.byteLength('private-pdf'),
      contentType: 'application/pdf',
    });
    expect(result).not.toHaveProperty('downloadURL');
    expect(save).toHaveBeenCalledWith(expect.any(Buffer), {
      resumable: false,
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          tenantId: 'tenant-a',
          draftId: 'draft-a',
          attachmentId: 'attachment-a',
        },
      },
    });
    expect(save.mock.calls[0]?.[1]?.metadata?.metadata).not.toHaveProperty('firebaseStorageDownloadTokens');
  });

  it('deletes a private draft attachment idempotently within its draft prefix', async () => {
    const deleteFile = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn((path: string) => ({ path, delete: deleteFile })),
    };
    const service = createProjectRequestContractStorageService({
      projectId: 'demo-bff-it',
      bucketName: 'demo-bff-it.firebasestorage.app',
      storage: { bucket: vi.fn(() => bucket) },
    });
    const path = 'orgs/tenant-a/project-registration-drafts/draft-a/attachment-a-contract.pdf';

    await service.deleteDraftAttachment({ tenantId: 'tenant-a', draftId: 'draft-a', path });

    expect(bucket.file).toHaveBeenCalledWith(path);
    expect(deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('refuses to delete an object outside the owned draft prefix', async () => {
    const deleteFile = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn(() => ({ delete: deleteFile })),
    };
    const service = createProjectRequestContractStorageService({
      projectId: 'demo-bff-it',
      bucketName: 'demo-bff-it.firebasestorage.app',
      storage: { bucket: vi.fn(() => bucket) },
    });

    await expect(service.deleteDraftAttachment({
      tenantId: 'tenant-a',
      draftId: 'draft-a',
      path: 'orgs/tenant-a/project-registration-drafts/draft-b/attachment-a-contract.pdf',
    })).rejects.toThrow('draft attachment path is outside its draft prefix');
    expect(bucket.file).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
