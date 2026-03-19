import { GoogleDriveBrowserUploadError } from './google-drive-browser-upload';

export function shouldFallbackToBffOnBrowserUploadError(error: unknown): boolean {
  if (error instanceof GoogleDriveBrowserUploadError) {
    return true;
  }

  // Browser fetch failures surface as TypeError in modern browsers.
  if (error instanceof TypeError) {
    return true;
  }

  return false;
}
