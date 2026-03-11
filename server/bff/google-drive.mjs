import fs from 'node:fs';
import { JWT } from 'google-auth-library';
import { resolveServiceAccount } from './firestore.mjs';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const INVALID_DRIVE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MULTI_SPACE = /\s+/g;
const MULTI_UNDERSCORE = /_+/g;

export class DriveServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DriveServiceError';
    this.statusCode = options.statusCode || 500;
    this.code = options.code || 'drive_error';
    this.details = options.details;
  }
}

function readOptionalText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSegment(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(INVALID_DRIVE_CHARS, ' ')
    .replace(MULTI_SPACE, ' ')
    .replace(/[()\[\]{}]/g, '')
    .replace(/\s/g, '_')
    .replace(MULTI_UNDERSCORE, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function escapeDriveQueryLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

export function extractDriveFolderId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const folderMatch = raw.match(/\/drive\/folders\/([A-Za-z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];

  const urlIdMatch = raw.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (urlIdMatch) return urlIdMatch[1];

  if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) {
    return raw;
  }

  return '';
}

function formatDriveDateToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'undated';
  const match = raw.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);
  if (!match) return normalizeSegment(raw.slice(0, 10), 'undated');
  return `${match[1]}${match[2]}${match[3]}`;
}

export function buildDriveProjectFolderName(projectName, projectId) {
  const nameToken = normalizeSegment(projectName, 'project');
  const idToken = normalizeSegment(projectId || '', '');
  return idToken ? `${nameToken}_${idToken}` : nameToken;
}

export function buildDriveTransactionFolderName(transaction) {
  const dateToken = formatDriveDateToken(transaction?.dateTime);
  const budgetToken = normalizeSegment(transaction?.budgetCategory || transaction?.counterparty || '미분류', '미분류');
  const subBudgetToken = normalizeSegment(transaction?.budgetSubCategory || transaction?.memo || '기타', '기타');
  const transactionToken = normalizeSegment(transaction?.id || '', 'tx');
  return [dateToken, budgetToken, subBudgetToken, transactionToken].join('_');
}

const CATEGORY_PATTERNS = [
  { category: '세금계산서', confidence: 0.96, patterns: [/세금계산서/i, /tax[_\s-]?invoice/i, /invoice/i] },
  { category: '영수증', confidence: 0.94, patterns: [/영수증/i, /receipt/i, /카드매출전표/i] },
  { category: '입금확인서', confidence: 0.9, patterns: [/입금확인/i, /송금확인/i, /transfer/i, /deposit/i] },
  { category: '계약서', confidence: 0.9, patterns: [/계약서/i, /contract/i, /agreement/i] },
  { category: '거래명세서', confidence: 0.86, patterns: [/거래명세/i, /statement/i] },
  { category: '지출결의서', confidence: 0.84, patterns: [/지출결의/i, /품의서/i] },
  { category: '참석자명단', confidence: 0.88, patterns: [/참석자명단/i, /출석부/i, /attendance/i] },
  { category: '결과보고서', confidence: 0.82, patterns: [/결과보고서/i, /보고서/i, /report/i] },
  { category: '통장사본', confidence: 0.8, patterns: [/통장사본/i, /bank[_\s-]?copy/i] },
  { category: '사진', confidence: 0.72, patterns: [/사진/i, /photo/i, /image/i] },
];

export function inferEvidenceCategoryFromFileName(fileName, fallback = '기타') {
  const normalized = String(fileName || '').trim();
  if (!normalized) return { category: fallback, confidence: 0.2 };
  const matched = CATEGORY_PATTERNS.find((entry) => entry.patterns.some((pattern) => pattern.test(normalized)));
  if (!matched) {
    return { category: fallback, confidence: 0.2 };
  }
  return { category: matched.category, confidence: matched.confidence };
}

export function buildEvidenceCompletedDesc(evidences) {
  const categories = (Array.isArray(evidences) ? evidences : [])
    .map((evidence) => evidence.category || evidence.parserCategory || inferEvidenceCategoryFromFileName(evidence.fileName).category)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(categories)].join(', ');
}

function splitEvidenceList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function computeEvidenceMissing(requiredValues, completedDesc) {
  const completed = splitEvidenceList(completedDesc).map((entry) => entry.toLowerCase());
  return requiredValues.filter((required) => !completed.some((entry) => entry.includes(required.toLowerCase())));
}

function computeEvidenceStatus({ hasLink, requiredValues, completedDesc }) {
  const completed = splitEvidenceList(completedDesc);
  if (!requiredValues.length) {
    if (hasLink && completed.length > 0) return 'COMPLETE';
    if (hasLink || completed.length > 0) return 'PARTIAL';
    return 'MISSING';
  }

  const missing = computeEvidenceMissing(requiredValues, completedDesc);
  if (missing.length === 0 && hasLink) return 'COMPLETE';
  if (hasLink || completed.length > 0) return 'PARTIAL';
  return 'MISSING';
}

function readRequiredEvidence(transaction) {
  if (Array.isArray(transaction?.evidenceRequired) && transaction.evidenceRequired.length > 0) {
    return transaction.evidenceRequired
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  return splitEvidenceList(transaction?.evidenceRequiredDesc);
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

export function resolveDriveServiceConfig(env = process.env) {
  const serviceAccount = resolveServiceAccountFromEnv(env);
  return {
    sharedDriveId: readOptionalText(env.GOOGLE_DRIVE_SHARED_DRIVE_ID),
    defaultParentFolderId: readOptionalText(env.GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID),
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

function buildFileQuery({ parentFolderId, folderOnly = false, appProperties = {}, name }) {
  const conditions = ['trashed = false'];
  if (folderOnly) {
    conditions.push(`mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`);
  } else {
    conditions.push(`mimeType != '${DRIVE_FOLDER_MIME_TYPE}'`);
  }
  if (parentFolderId) {
    conditions.push(`'${escapeDriveQueryLiteral(parentFolderId)}' in parents`);
  }
  if (name) {
    conditions.push(`name = '${escapeDriveQueryLiteral(name)}'`);
  }
  for (const [key, value] of Object.entries(appProperties)) {
    const normalizedValue = readOptionalText(value);
    if (!normalizedValue) continue;
    conditions.push(
      `appProperties has { key='${escapeDriveQueryLiteral(key)}' and value='${escapeDriveQueryLiteral(normalizedValue)}' }`,
    );
  }
  return conditions.join(' and ');
}

function normalizeDriveFile(file, fallbackDriveId = '') {
  return {
    id: readOptionalText(file?.id),
    name: readOptionalText(file?.name),
    mimeType: readOptionalText(file?.mimeType),
    size: Number.parseInt(String(file?.size || '0'), 10) || 0,
    webViewLink: readOptionalText(file?.webViewLink),
    webContentLink: readOptionalText(file?.webContentLink),
    modifiedTime: readOptionalText(file?.modifiedTime),
    createdTime: readOptionalText(file?.createdTime),
    parents: Array.isArray(file?.parents) ? file.parents.filter(Boolean) : [],
    driveId: readOptionalText(file?.driveId) || fallbackDriveId,
    appProperties: file?.appProperties && typeof file.appProperties === 'object' ? file.appProperties : {},
  };
}

export function resolveEvidenceSyncPatch({ transaction, evidences, folder }) {
  const autoCompletedDesc = buildEvidenceCompletedDesc(evidences);
  const previousCompleted = readOptionalText(transaction?.evidenceCompletedDesc);
  const previousAuto = readOptionalText(transaction?.evidenceAutoListedDesc);
  const completedDesc = !previousCompleted || previousCompleted === previousAuto
    ? autoCompletedDesc
    : previousCompleted;
  const requiredValues = readRequiredEvidence(transaction);
  const evidenceMissing = computeEvidenceMissing(requiredValues, completedDesc);
  const evidencePendingDesc = evidenceMissing.join(', ');
  const hasLink = !!readOptionalText(folder?.webViewLink) || !!readOptionalText(transaction?.evidenceDriveLink);

  return {
    attachmentsCount: evidences.length,
    evidenceAutoListedDesc: autoCompletedDesc || undefined,
    evidenceCompletedDesc: completedDesc || undefined,
    evidencePendingDesc: evidencePendingDesc || undefined,
    supportPendingDocs: evidencePendingDesc || undefined,
    evidenceMissing,
    evidenceStatus: computeEvidenceStatus({
      hasLink,
      requiredValues,
      completedDesc,
    }),
  };
}

export function createGoogleDriveService(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = options.config || resolveDriveServiceConfig(env);
  let jwtClient = null;

  function assertConfigured() {
    if (!config.enabled || !config.serviceAccount?.client_email || !config.serviceAccount?.private_key) {
      throw new DriveServiceError(
        'Google Drive service account is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_JSON.',
        { statusCode: 503, code: 'drive_not_configured' },
      );
    }
  }

  function getJwtClient() {
    assertConfigured();
    if (jwtClient) return jwtClient;
    jwtClient = new JWT({
      email: config.serviceAccount.client_email,
      key: config.serviceAccount.private_key,
      scopes: [DRIVE_SCOPE],
    });
    return jwtClient;
  }

  async function driveFetch(pathname, init = {}) {
    const client = getJwtClient();
    const authHeaders = await client.getRequestHeaders();
    const response = await fetchImpl(`${DRIVE_API_BASE_URL}${pathname}`, {
      ...init,
      headers: {
        ...authHeaders,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const details = await readJsonResponse(response);
      throw new DriveServiceError(
        `Google Drive API request failed (${response.status})`,
        {
          statusCode: response.status >= 500 ? 502 : response.status,
          code: 'drive_api_error',
          details,
        },
      );
    }

    return readJsonResponse(response);
  }

  async function getFile(fileId) {
    const normalizedId = readOptionalText(fileId);
    if (!normalizedId) return null;

    try {
      const data = await driveFetch(
        `/files/${encodeURIComponent(normalizedId)}?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents,driveId,appProperties`,
      );
      return normalizeDriveFile(data, config.sharedDriveId);
    } catch (error) {
      if (error instanceof DriveServiceError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async function findFolder({ parentFolderId, name, appProperties }) {
    const q = buildFileQuery({
      parentFolderId,
      folderOnly: true,
      appProperties,
      name,
    });
    const params = new URLSearchParams({
      q,
      pageSize: '10',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields: 'files(id,name,mimeType,webViewLink,parents,driveId,appProperties)',
    });
    const data = await driveFetch(`/files?${params.toString()}`);
    const first = Array.isArray(data?.files) ? data.files[0] : null;
    return first ? normalizeDriveFile(first, config.sharedDriveId) : null;
  }

  async function createFolder({ name, parentFolderId, appProperties = {} }) {
    const normalizedParentId = readOptionalText(parentFolderId);
    if (!normalizedParentId) {
      throw new DriveServiceError(
        'A parent folder is required to create an evidence folder. Set GOOGLE_DRIVE_EVIDENCE_ROOT_FOLDER_ID.',
        { statusCode: 503, code: 'drive_parent_missing' },
      );
    }

    const data = await driveFetch('/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents,driveId,appProperties', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: [normalizedParentId],
        appProperties,
      }),
    });
    return normalizeDriveFile(data, config.sharedDriveId);
  }

  async function ensureProjectRootFolder({ tenantId, projectId, projectName, existingFolderId, preferredParentFolderId }) {
    const existingFolder = await getFile(existingFolderId);
    if (existingFolder) {
      return existingFolder;
    }

    const parentFolderId = readOptionalText(preferredParentFolderId) || config.defaultParentFolderId;
    const folderName = buildDriveProjectFolderName(projectName, projectId);
    const appProperties = {
      managedBy: 'mysc-platform',
      tenantId,
      projectId,
      folderRole: 'project-root',
    };

    const found = await findFolder({ parentFolderId, name: folderName, appProperties });
    if (found) {
      return found;
    }

    return createFolder({
      name: folderName,
      parentFolderId,
      appProperties,
    });
  }

  async function ensureTransactionFolder({ tenantId, projectId, projectName, transaction, projectFolderId, existingFolderId }) {
    const existingFolder = await getFile(existingFolderId);
    if (existingFolder) {
      return existingFolder;
    }

    const projectRootFolder = await ensureProjectRootFolder({
      tenantId,
      projectId,
      projectName,
      existingFolderId: projectFolderId,
    });
    const folderName = buildDriveTransactionFolderName(transaction);
    const appProperties = {
      managedBy: 'mysc-platform',
      tenantId,
      projectId,
      transactionId: transaction.id,
      folderRole: 'transaction-root',
    };

    const found = await findFolder({
      parentFolderId: projectRootFolder.id,
      name: folderName,
      appProperties,
    });
    if (found) {
      return {
        folder: found,
        projectRootFolder,
      };
    }

    const folder = await createFolder({
      name: folderName,
      parentFolderId: projectRootFolder.id,
      appProperties,
    });
    return {
      folder,
      projectRootFolder,
    };
  }

  async function listFolderFiles({ folderId }) {
    const normalizedFolderId = readOptionalText(folderId);
    if (!normalizedFolderId) {
      throw new DriveServiceError('folderId is required', { statusCode: 400, code: 'drive_folder_id_required' });
    }

    const files = [];
    let pageToken = '';

    do {
      const params = new URLSearchParams({
        q: buildFileQuery({ parentFolderId: normalizedFolderId, folderOnly: false }),
        pageSize: '200',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
        orderBy: 'createdTime asc,name',
        fields: 'nextPageToken,files(id,name,mimeType,size,webViewLink,webContentLink,modifiedTime,createdTime,parents,driveId,appProperties)',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const data = await driveFetch(`/files?${params.toString()}`);
      const nextItems = Array.isArray(data?.files)
        ? data.files.map((item) => normalizeDriveFile(item, config.sharedDriveId))
        : [];
      files.push(...nextItems);
      pageToken = readOptionalText(data?.nextPageToken);
    } while (pageToken);

    return files;
  }

  return {
    getConfig() {
      return {
        enabled: config.enabled,
        sharedDriveId: config.sharedDriveId,
        defaultParentFolderId: config.defaultParentFolderId,
        serviceAccountEmail: readOptionalText(config.serviceAccount?.client_email),
      };
    },
    assertConfigured,
    getFile,
    ensureProjectRootFolder,
    ensureTransactionFolder,
    listFolderFiles,
  };
}
