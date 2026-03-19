import { describe, expect, it } from 'vitest';
import { GoogleDriveBrowserUploadError } from './google-drive-browser-upload';
import { shouldFallbackToBffOnBrowserUploadError } from './evidence-drive-upload';

describe('evidence-drive-upload', () => {
  it('falls back to BFF for structured browser upload errors', () => {
    expect(shouldFallbackToBffOnBrowserUploadError(
      new GoogleDriveBrowserUploadError('Google Drive 업로드 실패 (403)', 403),
    )).toBe(true);
  });

  it('falls back to BFF for browser fetch transport errors', () => {
    expect(shouldFallbackToBffOnBrowserUploadError(
      new TypeError('Failed to fetch'),
    )).toBe(true);
  });

  it('does not swallow unrelated application errors', () => {
    expect(shouldFallbackToBffOnBrowserUploadError(
      new Error('unexpected'),
    )).toBe(false);
  });
});
