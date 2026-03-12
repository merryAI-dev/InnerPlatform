import { describe, expect, it, vi } from 'vitest';
import {
  GoogleDriveBrowserUploadError,
  uploadFileToGoogleDriveFolder,
} from './google-drive-browser-upload';

describe('google-drive-browser-upload', () => {
  it('uploads a file to Google Drive with multipart metadata', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'drv-file-001',
      name: '20260312_회의비_다과비_영수증.pdf',
      mimeType: 'application/pdf',
      size: '1024',
      webViewLink: 'https://drive.google.com/file/d/drv-file-001/view',
      parents: ['folder-001'],
      driveId: 'drive-001',
      appProperties: {
        transactionId: 'tx001',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['fake-pdf'], 'raw.pdf', { type: 'application/pdf' });
    const result = await uploadFileToGoogleDriveFolder({
      accessToken: 'google-token-123',
      folderId: 'folder-001',
      file,
      fileName: '20260312_회의비_다과비_영수증.pdf',
      appProperties: {
        transactionId: 'tx001',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] || [];
    expect(String(url)).toContain('uploadType=multipart');
    expect(init?.method).toBe('POST');
    expect(init?.headers?.authorization).toBe('Bearer google-token-123');
    expect(result.id).toBe('drv-file-001');
    expect(result.driveId).toBe('drive-001');

    vi.unstubAllGlobals();
  });

  it('throws a structured error when Google Drive rejects the upload', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 403,
        message: 'insufficient permissions',
      },
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));

    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['fake-pdf'], 'raw.pdf', { type: 'application/pdf' });
    await expect(uploadFileToGoogleDriveFolder({
      accessToken: 'google-token-123',
      folderId: 'folder-001',
      file,
      fileName: '20260312_회의비_다과비_영수증.pdf',
    })).rejects.toBeInstanceOf(GoogleDriveBrowserUploadError);

    vi.unstubAllGlobals();
  });
});
