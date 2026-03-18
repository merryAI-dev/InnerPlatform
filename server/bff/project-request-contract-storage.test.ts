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
});
