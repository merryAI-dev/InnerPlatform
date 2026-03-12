import fs from 'node:fs';
import { JWT } from 'google-auth-library';
import { resolveServiceAccount } from './firestore.mjs';

const SHEETS_API_BASE_URL = 'https://sheets.googleapis.com/v4';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export class GoogleSheetsServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GoogleSheetsServiceError';
    this.statusCode = options.statusCode || 500;
    this.code = options.code || 'google_sheets_error';
    this.details = options.details;
  }
}

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveServiceAccountFromEnv(env = process.env) {
  const rawPath = readOptionalText(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH);
  if (rawPath) {
    return resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_JSON: fs.readFileSync(rawPath, 'utf8'),
      FIREBASE_SERVICE_ACCOUNT_BASE64: '',
    });
  }

  const rawJson = readOptionalText(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
  if (rawJson) {
    return resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_JSON: rawJson,
      FIREBASE_SERVICE_ACCOUNT_BASE64: '',
    });
  }

  const rawBase64 = readOptionalText(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_BASE64);
  if (rawBase64) {
    return resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
      FIREBASE_SERVICE_ACCOUNT_BASE64: rawBase64,
    });
  }

  return resolveServiceAccount(env);
}

export function resolveGoogleSheetsServiceConfig(env = process.env) {
  const serviceAccount = resolveServiceAccountFromEnv(env);
  return {
    serviceAccount,
    enabled: !!serviceAccount,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function extractSpreadsheetId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const linkMatch = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9-_]+)/);
  if (linkMatch) return linkMatch[1];

  const urlIdMatch = raw.match(/[?&]id=([A-Za-z0-9-_]+)/);
  if (urlIdMatch) return urlIdMatch[1];

  if (/^[A-Za-z0-9-_]{20,}$/.test(raw)) {
    return raw;
  }

  return '';
}

export function extractSpreadsheetGid(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const gidMatch = raw.match(/[?&#]gid=(\d+)/);
  if (!gidMatch) return null;
  const parsed = Number.parseInt(gidMatch[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSheetTitle(title) {
  return readOptionalText(title) || 'Sheet1';
}

function quoteSheetNameForRange(sheetName) {
  const normalized = normalizeSheetTitle(sheetName);
  return `'${normalized.replace(/'/g, "''")}'`;
}

function normalizeSheetDescriptor(sheet) {
  return {
    sheetId: readOptionalNumber(sheet?.properties?.sheetId) ?? 0,
    title: normalizeSheetTitle(sheet?.properties?.title),
    index: readOptionalNumber(sheet?.properties?.index) ?? 0,
  };
}

export function createGoogleSheetsService(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = options.config || resolveGoogleSheetsServiceConfig(env);
  const authHeadersFactory = options.authHeadersFactory;
  let jwtClient = null;

  function assertConfigured() {
    if (!config.enabled || !config.serviceAccount?.client_email || !config.serviceAccount?.private_key) {
      throw new GoogleSheetsServiceError(
        'Google Sheets service account is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON.',
        { statusCode: 503, code: 'google_sheets_not_configured' },
      );
    }
  }

  async function getAuthHeaders() {
    if (typeof authHeadersFactory === 'function') {
      return authHeadersFactory();
    }
    assertConfigured();
    if (!jwtClient) {
      jwtClient = new JWT({
        email: config.serviceAccount.client_email,
        key: config.serviceAccount.private_key,
        scopes: [SHEETS_SCOPE],
      });
    }
    return jwtClient.getRequestHeaders();
  }

  async function sheetsFetch(pathname, init = {}) {
    const authHeaders = await getAuthHeaders();
    const response = await fetchImpl(`${SHEETS_API_BASE_URL}${pathname}`, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const details = await readJsonResponse(response);
      throw new GoogleSheetsServiceError(
        `Google Sheets API request failed (${response.status})`,
        {
          statusCode: response.status >= 500 ? 502 : response.status,
          code: 'google_sheets_api_error',
          details,
        },
      );
    }

    return readJsonResponse(response);
  }

  async function getSpreadsheetMeta(spreadsheetId) {
    const normalizedId = extractSpreadsheetId(spreadsheetId);
    if (!normalizedId) {
      throw new GoogleSheetsServiceError(
        'Google Sheets 링크 또는 spreadsheet ID를 입력해 주세요.',
        { statusCode: 400, code: 'spreadsheet_id_required' },
      );
    }

    const fields = [
      'spreadsheetId',
      'properties.title',
      'sheets.properties.sheetId',
      'sheets.properties.title',
      'sheets.properties.index',
    ].join(',');
    const data = await sheetsFetch(`/spreadsheets/${encodeURIComponent(normalizedId)}?fields=${encodeURIComponent(fields)}`);
    const availableSheets = Array.isArray(data?.sheets)
      ? data.sheets.map((sheet) => normalizeSheetDescriptor(sheet)).sort((a, b) => a.index - b.index)
      : [];

    return {
      spreadsheetId: normalizedId,
      spreadsheetTitle: readOptionalText(data?.properties?.title) || normalizedId,
      availableSheets,
    };
  }

  async function getSheetValues({ spreadsheetId, sheetName }) {
    const normalizedId = extractSpreadsheetId(spreadsheetId);
    const normalizedSheetName = normalizeSheetTitle(sheetName);
    const range = quoteSheetNameForRange(normalizedSheetName);
    const params = new URLSearchParams({
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });

    const data = await sheetsFetch(
      `/spreadsheets/${encodeURIComponent(normalizedId)}/values/${encodeURIComponent(range)}?${params.toString()}`,
    );

    return Array.isArray(data?.values)
      ? data.values.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []))
      : [];
  }

  async function previewSpreadsheet({ value, sheetName }) {
    const spreadsheetId = extractSpreadsheetId(value);
    if (!spreadsheetId) {
      throw new GoogleSheetsServiceError(
        'Google Sheets 링크 또는 spreadsheet ID를 입력해 주세요.',
        { statusCode: 400, code: 'spreadsheet_id_required' },
      );
    }

    const gid = sheetName ? null : extractSpreadsheetGid(value);
    const meta = await getSpreadsheetMeta(spreadsheetId);

    let selectedSheet = null;
    if (sheetName) {
      selectedSheet = meta.availableSheets.find((sheet) => sheet.title === sheetName) || null;
      if (!selectedSheet) {
        throw new GoogleSheetsServiceError(
          `시트 탭을 찾을 수 없습니다: ${sheetName}`,
          { statusCode: 404, code: 'sheet_tab_not_found' },
        );
      }
    } else if (gid != null) {
      selectedSheet = meta.availableSheets.find((sheet) => sheet.sheetId === gid) || null;
    }

    if (!selectedSheet) {
      selectedSheet = meta.availableSheets[0] || null;
    }
    if (!selectedSheet) {
      throw new GoogleSheetsServiceError(
        '읽을 수 있는 시트 탭이 없습니다.',
        { statusCode: 404, code: 'sheet_tab_missing' },
      );
    }

    const matrix = await getSheetValues({
      spreadsheetId: meta.spreadsheetId,
      sheetName: selectedSheet.title,
    });

    return {
      spreadsheetId: meta.spreadsheetId,
      spreadsheetTitle: meta.spreadsheetTitle,
      selectedSheetName: selectedSheet.title,
      availableSheets: meta.availableSheets,
      matrix,
    };
  }

  return {
    getSpreadsheetMeta,
    getSheetValues,
    previewSpreadsheet,
  };
}
