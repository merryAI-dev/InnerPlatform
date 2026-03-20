import { describe, expect, it, vi } from 'vitest';
import {
  createProjectSheetSourceStorageService,
  normalizeSafeFileName,
} from './project-sheet-source-storage.mjs';

describe('project-sheet-source-storage', () => {
  it('normalizes workbook file names for storage paths', () => {
    expect(normalizeSafeFileName(' 25_환경AC_사업비 관리 시트.xlsx ')).toBe('25_환경AC_사업비_관리_시트.xlsx');
  });

  it('uploads a project workbook source via injected storage bucket', async () => {
    const save = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn(() => ({ save })),
    };
    const storage = {
      bucket: vi.fn(() => bucket),
    };

    const service = createProjectSheetSourceStorageService({
      projectId: 'inner-platform-live-20260316',
      bucketName: 'inner-platform-live-20260316.firebasestorage.app',
      storage,
    });

    const result = await service.uploadSource({
      tenantId: 'mysc',
      actorId: 'u001',
      projectId: 'p001',
      sourceType: 'usage',
      fileName: '환경AC.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 32,
      contentBase64: Buffer.from('fake-xlsx', 'utf8').toString('base64'),
    });

    expect(storage.bucket).toHaveBeenCalledWith('inner-platform-live-20260316.firebasestorage.app');
    expect(save).toHaveBeenCalled();
    expect(result.path).toContain('orgs/mysc/project-sheet-sources/p001/usage/');
    expect(result.downloadURL).toContain('firebasestorage.googleapis.com');
  });
});
