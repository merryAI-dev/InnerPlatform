export interface GoogleDriveBrowserUploadFile {
  id: string;
  name: string;
  mimeType: string | null;
  size: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  modifiedTime: string | null;
  createdTime: string | null;
  parents: string[];
  driveId: string | null;
  appProperties: Record<string, string>;
}

export class GoogleDriveBrowserUploadError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'GoogleDriveBrowserUploadError';
    this.status = status;
    this.details = details;
  }
}

function readOptionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeDriveFile(value: any): GoogleDriveBrowserUploadFile {
  const appProperties = value?.appProperties && typeof value.appProperties === 'object'
    ? Object.fromEntries(
      Object.entries(value.appProperties)
        .map(([key, raw]) => [String(key), readOptionalText(raw)])
        .filter(([, raw]) => raw),
    )
    : {};

  return {
    id: readOptionalText(value?.id),
    name: readOptionalText(value?.name),
    mimeType: readOptionalText(value?.mimeType) || null,
    size: readOptionalText(value?.size) || null,
    webViewLink: readOptionalText(value?.webViewLink) || null,
    webContentLink: readOptionalText(value?.webContentLink) || null,
    modifiedTime: readOptionalText(value?.modifiedTime) || null,
    createdTime: readOptionalText(value?.createdTime) || null,
    parents: Array.isArray(value?.parents) ? value.parents.map((entry: unknown) => readOptionalText(entry)).filter(Boolean) : [],
    driveId: readOptionalText(value?.driveId) || null,
    appProperties,
  };
}

export async function uploadFileToGoogleDriveFolder(params: {
  accessToken: string;
  folderId: string;
  file: File;
  fileName: string;
  mimeType?: string;
  appProperties?: Record<string, string>;
}): Promise<GoogleDriveBrowserUploadFile> {
  const accessToken = readOptionalText(params.accessToken);
  const folderId = readOptionalText(params.folderId);
  const fileName = readOptionalText(params.fileName);
  const mimeType = readOptionalText(params.mimeType) || params.file.type || 'application/octet-stream';

  if (!accessToken) {
    throw new GoogleDriveBrowserUploadError('Google Drive access token is required.', 401);
  }
  if (!folderId) {
    throw new GoogleDriveBrowserUploadError('Google Drive folder is required.', 400);
  }
  if (!fileName) {
    throw new GoogleDriveBrowserUploadError('업로드 파일명이 비어 있습니다.', 400);
  }

  const boundary = `driveupload_${Date.now().toString(36)}`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    appProperties: params.appProperties || {},
  };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    params.file,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink,modifiedTime,createdTime,parents,driveId,appProperties',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  const data = await readJsonSafe(response);
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? `Google Drive 업로드 실패 (${response.status})`
      : `Google Drive 업로드 실패 (${response.status})`;
    throw new GoogleDriveBrowserUploadError(message, response.status, data);
  }

  return normalizeDriveFile(data);
}
