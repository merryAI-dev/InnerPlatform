import { describe, expect, it, vi } from 'vitest';
import {
  createBusinessCardStorageService,
  normalizeStoragePathSegment,
  normalizeSafeFileName,
} from './business-card-storage.mjs';

describe('business-card-storage', () => {
  it('normalizes file names for private storage paths', () => {
    expect(normalizeSafeFileName(' 명함 (최종) !.png ')).toBe('명함_(최종)_.png');
  });

  it('normalizes Storage path segments separately from display file names', () => {
    expect(normalizeStoragePathSegment(' user/../001 ', 'system')).toBe('user_.._001');
    expect(normalizeStoragePathSegment('', 'system')).toBe('system');
  });

  it('uploads without creating Firebase public download tokens', async () => {
    const save = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn(() => ({ save })),
    };
    const storage = {
      bucket: vi.fn(() => bucket),
    };

    const service = createBusinessCardStorageService({
      projectId: 'inner-platform-live-20260316',
      bucketName: 'inner-platform-live-20260316.firebasestorage.app',
      storage,
    });

    const result = await service.uploadBusinessCard({
      tenantId: 'mysc',
      actorId: 'u001/../bad',
      importId: 'bcimp_001',
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('fake-image', 'utf8').toString('base64'),
    });

    expect(result.path).toBe('orgs/mysc/business-cards/u001_.._bad/bcimp_001-card.jpg');
    expect(save).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      resumable: false,
      metadata: expect.objectContaining({
        contentType: 'image/jpeg',
        metadata: expect.not.objectContaining({
          firebaseStorageDownloadTokens: expect.any(String),
        }),
      }),
    }));
  });

  it('rejects payloads whose decoded bytes exceed the server limit', async () => {
    const save = vi.fn(async () => undefined);
    const bucket = {
      file: vi.fn(() => ({ save })),
    };
    const storage = {
      bucket: vi.fn(() => bucket),
    };

    const service = createBusinessCardStorageService({
      projectId: 'inner-platform-live-20260316',
      bucketName: 'inner-platform-live-20260316.firebasestorage.app',
      storage,
      maxImageBytes: 4,
    });

    await expect(service.uploadBusinessCard({
      tenantId: 'mysc',
      actorId: 'u001',
      importId: 'bcimp_001',
      fileName: 'card.jpg',
      mimeType: 'image/jpeg',
      contentBase64: Buffer.from('too-large', 'utf8').toString('base64'),
    })).rejects.toMatchObject({
      statusCode: 413,
      code: 'business_card_image_too_large',
    });
    expect(save).not.toHaveBeenCalled();
  });
});
