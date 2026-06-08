#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import { createFirestoreDb, resolveProjectId } from '../server/bff/firestore.mjs';

const DEFAULT_TENANT_ID = 'mysc';
const DEFAULT_OUT_DIR = 'output/backups/project-sheets';
const JSON_PREVIEW_LIMIT = 30000;

const PROJECT_TABS = [
  {
    sheetName: '사업_기본정보',
    source: 'project-doc',
    columns: [
      ['사업ID', ['id']],
      ['사업명', ['name', 'title']],
      ['상태', ['status']],
      ['단계', ['phase']],
      ['회계유형', ['accountType']],
      ['담당자UID', ['ownerUid', 'managerId']],
      ['등록자UID', ['registeredById']],
      ['계약금액', ['contractAmount', 'amount']],
      ['시작일', ['startDate']],
      ['종료일', ['endDate']],
    ],
  },
  {
    sheetName: '원장_목록',
    topLevelCollections: ['ledgers'],
    columns: [
      ['원장ID', ['id']],
      ['원장명', ['name', 'title']],
      ['유형', ['type', 'kind']],
      ['상태', ['status']],
      ['버전', ['version']],
    ],
  },
  {
    sheetName: '거래_내역',
    topLevelCollections: ['transactions'],
    columns: [
      ['거래ID', ['id']],
      ['원장ID', ['ledgerId']],
      ['처리상태', ['state', 'status']],
      ['금액', ['amount']],
      ['거래일시', ['dateTime', 'date', 'transactionDate']],
      ['거래처', ['counterparty', 'vendor', 'counterpartyName']],
      ['예산코드', ['budgetCode', 'budgetKey']],
      ['캐시플로항목', ['cashflowLineId', 'cashflowCategory']],
      ['증빙상태', ['evidenceStatus']],
    ],
  },
  {
    sheetName: '캐시플로_주차별',
    topLevelCollections: ['cashflow_weeks', 'cashflowWeeks'],
    columns: [
      ['년월', ['yearMonth']],
      ['주차', ['weekNo']],
      ['구분', ['mode']],
      ['항목ID', ['lineId']],
      ['금액', ['amount']],
      ['예상합계', ['projectionTotal']],
      ['실제합계', ['actualTotal']],
    ],
  },
  {
    sheetName: '주간제출_상태',
    topLevelCollections: ['weekly_submission_status', 'weeklySubmissionStatus'],
    columns: [
      ['년월', ['yearMonth']],
      ['주차', ['weekNo']],
      ['제출상태', ['status', 'state']],
      ['제출일시', ['submittedAt']],
      ['승인일시', ['approvedAt']],
    ],
  },
  {
    sheetName: '사업비_세트',
    topLevelCollections: ['expense_sets', 'expenseSets'],
    columns: [
      ['세트ID', ['id']],
      ['상태', ['status', 'state']],
      ['총액', ['totalAmount', 'amount']],
      ['제출자', ['submittedBy', 'submittedByName']],
      ['제출일시', ['submittedAt']],
    ],
  },
  {
    sheetName: '변경요청_내역',
    topLevelCollections: ['change_requests', 'changeRequests', 'project_requests', 'projectRequests'],
    projectFields: ['projectId', 'approvedProjectId'],
    columns: [
      ['요청ID', ['id']],
      ['유형', ['type', 'requestType']],
      ['상태', ['status', 'state']],
      ['요청자', ['requestedBy', 'requestedByName', 'ownerName']],
      ['승인자', ['approvedBy', 'approvedByName']],
      ['생성일', ['createdAt']],
    ],
  },
  {
    sheetName: '사업비_입력시트',
    subcollections: ['expense_sheets'],
    columns: [
      ['시트ID', ['id']],
      ['시트명', ['name', 'title']],
      ['행수', ['rowCount', 'rows.length']],
      ['열수', ['columnCount', 'columns.length']],
      ['활성여부', ['active', 'isActive']],
      ['수정자', ['updatedBy']],
      ['수정일', ['updatedAt']],
    ],
  },
  {
    sheetName: '사업비_인테이크',
    subcollections: ['expense_intake'],
    columns: [
      ['인테이크ID', ['id']],
      ['은행지문', ['bankFingerprint', 'fingerprint']],
      ['처리상태', ['status', 'state']],
      ['대상시트ID', ['targetSheetId', 'expenseSheetId']],
      ['원천거래ID', ['sourceTxId']],
      ['거래일', ['transactionDate', 'date', 'bankSnapshot.date']],
      ['거래처', ['counterparty', 'vendor', 'bankSnapshot.counterparty', 'bankSnapshot.description']],
      ['금액', ['amount', 'bankSnapshot.amount', 'manualFields.expenseAmount']],
      ['캐시플로항목', ['cashflowCategory', 'manualFields.cashflowCategory']],
      ['증빙상태', ['evidenceStatus']],
      ['수정일', ['updatedAt']],
    ],
  },
  {
    sheetName: '증빙_원본',
    linkedTopLevelCollections: [
      {
        collectionName: 'evidences',
        sourceCollectionName: 'transactions',
        sourceProjectFields: ['projectId'],
        linkField: 'transactionId',
      },
    ],
    columns: [
      ['증빙ID', ['id']],
      ['거래ID', ['transactionId']],
      ['파일명', ['fileName', 'name']],
      ['분류', ['category']],
      ['상태', ['status']],
      ['업로드자', ['uploadedBy', 'uploadedByName']],
      ['업로드일', ['uploadedAt']],
      ['Drive파일ID', ['driveFileId', 'fileId']],
    ],
  },
  {
    sheetName: '증빙_매핑',
    topLevelCollections: ['budgetEvidenceMaps'],
    subcollections: ['budget_evidence_maps'],
    columns: [
      ['예산키', ['budgetKey', 'code']],
      ['증빙분류', ['evidenceCategory', 'category']],
      ['필수여부', ['required']],
      ['완료여부', ['completed']],
    ],
  },
  {
    sheetName: '시트_원본',
    subcollections: ['sheet_sources'],
    topLevelCollections: ['project-sheet-sources'],
    columns: [
      ['원본유형', ['sourceType', 'type']],
      ['시트명', ['sheetName']],
      ['적용대상', ['applyTarget']],
      ['원본해시', ['sourceHash', 'hash']],
      ['업로드일시', ['uploadedAt', 'createdAt']],
    ],
  },
  {
    sheetName: '은행거래_대조',
    subcollections: ['bank_statements'],
    columns: [
      ['기간', ['period', 'yearMonth']],
      ['은행명', ['bankName']],
      ['행수', ['rowCount']],
      ['매칭건수', ['matchedCount']],
      ['미매칭건수', ['unmatchedCount']],
    ],
  },
  {
    sheetName: '예산_요약',
    subcollections: ['budget_summary'],
    columns: [
      ['요약ID', ['id']],
      ['총예산', ['totalBudget', 'budgetTotal', 'amount']],
      ['집행액', ['spentAmount', 'actualAmount', 'expenseAmount']],
      ['잔액', ['remainingAmount', 'balance']],
      ['년월', ['yearMonth']],
      ['수정일', ['updatedAt']],
    ],
  },
  {
    sheetName: '예산_코드북',
    subcollections: ['budget_code_book'],
    columns: [
      ['코드ID', ['id']],
      ['예산코드', ['budgetCode', 'code']],
      ['비목', ['category', 'budgetCategory']],
      ['세목', ['subCategory', 'item']],
      ['세세목', ['detailCategory', 'subItem']],
      ['캐시플로항목', ['cashflowCategory', 'cashflowLineId']],
      ['수정일', ['updatedAt']],
    ],
  },
  {
    sheetName: '인건비_지급',
    topLevelCollections: ['payrollRuns', 'payroll_runs'],
    columns: [
      ['지급ID', ['id']],
      ['년월', ['yearMonth']],
      ['상태', ['status', 'state']],
      ['예정지급일', ['plannedPayDate']],
      ['총액', ['totalAmount', 'amount']],
    ],
  },
  {
    sheetName: '월마감_내역',
    topLevelCollections: ['monthlyCloses', 'monthly_closes'],
    columns: [
      ['마감ID', ['id']],
      ['년월', ['yearMonth']],
      ['상태', ['status', 'state']],
      ['마감자', ['closedBy', 'closedByName']],
      ['마감일시', ['closedAt']],
    ],
  },
  {
    sheetName: '참여인력_스냅샷',
    source: 'members',
    columns: [
      ['UID', ['uid', 'id']],
      ['이름', ['name', 'displayName']],
      ['이메일마스킹', ['email']],
      ['역할', ['role']],
      ['사업내역할', ['projectRole']],
      ['참여율', ['participationRate']],
    ],
  },
  {
    sheetName: '감사로그_색인',
    topLevelCollections: ['audit_logs', 'auditLogs'],
    columns: [
      ['액션', ['action']],
      ['대상유형', ['entityType']],
      ['대상ID', ['entityId']],
      ['행위자역할', ['actorRole']],
      ['요청ID', ['requestId']],
      ['일시', ['timestamp', 'createdAt']],
    ],
  },
];

const COMMON_COLUMNS = [
  { header: '백업ID', key: 'backupRunId', width: 26, hidden: true },
  { header: '조직ID', key: 'tenantId', width: 14, hidden: true },
  { header: '사업ID', key: 'projectId', width: 22 },
  { header: '사업명', key: 'projectName', width: 34 },
  { header: '컬렉션', key: 'collection', width: 26 },
  { header: '문서경로', key: 'docPath', width: 52, hidden: true },
  { header: '문서ID', key: 'docId', width: 26, hidden: true },
  { header: '스키마버전', key: 'schemaVersion', width: 12, hidden: true },
  { header: '버전', key: 'version', width: 10, hidden: true },
  { header: '생성일', key: 'createdAt', width: 22, hidden: true },
  { header: '수정일', key: 'updatedAt', width: 22, hidden: true },
  { header: '삭제일', key: 'deletedAt', width: 22, hidden: true },
  { header: '해시', key: 'hash', width: 18, hidden: true },
  { header: 'JSON_마스킹본', key: 'jsonPreview', width: 80, hidden: true },
  { header: 'JSON해시', key: 'jsonHash', width: 66, hidden: true },
  { header: 'JSON참조', key: 'jsonRef', width: 36, hidden: true },
];

const REVIEW_INPUT_COLUMNS = [
  { header: '입력액션', key: 'inputAction', width: 14 },
  { header: '검수상태', key: 'reviewStatus', width: 14 },
  { header: '입력메모', key: 'inputMemo', width: 36 },
];

const DETAIL_SHEET_CONFIGS = [
  {
    sourceSheetName: '사업비_입력시트',
    sheetName: '사업비_입력시트_행',
    arrayPath: ['rows'],
    rowColumns: [
      ['행임시ID', ['tempId']],
      ['원천거래ID', ['sourceTxId']],
      ['입력종류', ['entryKind']],
    ],
    cellsPath: ['cells'],
    cellPrefix: '셀',
  },
  {
    sourceSheetName: '은행거래_대조',
    sheetName: '은행거래_원본행',
    arrayPath: ['rows'],
    rowColumns: [
      ['행임시ID', ['tempId']],
    ],
    cellsPath: ['cells'],
    cellPrefix: '셀',
  },
  {
    sourceSheetName: '예산_요약',
    sheetName: '예산_요약_행',
    arrayPath: ['rows'],
    rowColumns: [
      ['예산코드', ['budgetCode']],
      ['하위코드', ['subCode']],
      ['최초예산', ['initialBudget']],
      ['수정예산', ['revisedBudget']],
    ],
  },
  {
    sourceSheetName: '예산_코드북',
    sheetName: '예산_코드북_상세',
    arrayPath: ['codes'],
    rowColumns: [
      ['예산코드', ['code']],
    ],
    nestedArrayPath: ['subCodes'],
    nestedColumn: '하위코드',
  },
  {
    sourceSheetName: '시트_원본',
    sheetName: '시트_원본_미리보기행',
    arrayPath: ['previewMatrixRows'],
    rowColumns: [],
    cellsPath: ['cells'],
    cellPrefix: '셀',
  },
];

function parseArgs(argv) {
  const args = {
    tenantId: process.env.BACKUP_TENANT_ID || DEFAULT_TENANT_ID,
    outDir: process.env.BACKUP_OUT_DIR || DEFAULT_OUT_DIR,
    reason: 'manual project sheet backup',
    createdBy: process.env.USER || 'unknown',
    includeTrashed: false,
    includeAdminLedger: true,
    projectIds: [],
    gcsBucket: process.env.BACKUP_GCS_BUCKET || '',
    gcsPrefix: process.env.BACKUP_GCS_PREFIX || 'inner-platform/firestore-project-sheets',
    driveFolderId: process.env.BACKUP_DRIVE_FOLDER_ID || '',
    driveConvertSheets: process.env.BACKUP_DRIVE_CONVERT_SHEETS !== 'false',
    driveRequired: process.env.BACKUP_DRIVE_REQUIRED === 'true',
    slackWebhookUrl: process.env.BACKUP_SLACK_WEBHOOK_URL || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--tenant') args.tenantId = next();
    else if (arg === '--project') args.projectIds.push(next());
    else if (arg === '--out') args.outDir = next();
    else if (arg === '--reason') args.reason = next();
    else if (arg === '--created-by') args.createdBy = next();
    else if (arg === '--include-trashed') args.includeTrashed = true;
    else if (arg === '--no-admin-ledger') args.includeAdminLedger = false;
    else if (arg === '--gcs-bucket') args.gcsBucket = next();
    else if (arg === '--gcs-prefix') args.gcsPrefix = next();
    else if (arg === '--drive-folder-id') args.driveFolderId = next();
    else if (arg === '--no-drive-convert-sheets') args.driveConvertSheets = false;
    else if (arg === '--drive-required') args.driveRequired = true;
    else if (arg === '--slack-webhook-url') args.slackWebhookUrl = next();
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/export_project_sheet_backups.mjs --tenant mysc [--project p-1] [--out output/backups/project-sheets]

Options:
  --tenant <id>          Tenant/org id. Defaults to BACKUP_TENANT_ID or mysc.
  --project <id>         Export one project. Repeat for multiple projects. Defaults to all non-trashed projects.
  --out <dir>            Output directory. Defaults to ${DEFAULT_OUT_DIR}.
  --reason <text>        Backup reason written into manifests.
  --created-by <name>    Backup operator. Defaults to USER.
  --include-trashed      Include projects with trashedAt.
  --no-admin-ledger      Skip 관리자/global 원장 spreadsheet.
  --gcs-bucket <bucket>  Upload canonical JSONL/manifests and XLSX files to this GCS bucket.
  --gcs-prefix <prefix>  GCS object prefix. Defaults to BACKUP_GCS_PREFIX or inner-platform/firestore-project-sheets.
  --drive-folder-id <id> Upload review copies to this Google Drive/Shared Drive folder.
  --no-drive-convert-sheets
                         Keep XLSX files as XLSX in Drive instead of converting them to native Google Sheets.
  --drive-required       Fail the run when Drive review-copy upload fails. By default, Drive is best-effort.
  --slack-webhook-url <url>
                         Send a completion/failure notification to Slack. Defaults to BACKUP_SLACK_WEBHOOK_URL.
`);
}

function assertTenantId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(normalized)) {
    throw new Error(`Invalid tenant id: ${value}`);
  }
  return normalized;
}

function nowIso() {
  return new Date().toISOString();
}

function compactTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function humanTimestamp(iso) {
  return iso.replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, '');
}

function backupDate(iso) {
  return String(iso || '').slice(0, 10) || 'unknown-date';
}

function sanitizeFileToken(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown';
}

function sanitizeDriveName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'unknown';
}

function escapeDriveQueryValue(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function getGitValue(args, fallback = '') {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function normalizeFirestoreValue(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeFirestoreValue);
  }
  if (value.path && typeof value.path === 'string' && value.firestore) {
    return { __refPath: value.path };
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = normalizeFirestoreValue(child);
  }
  return out;
}

function encodeRestoreValue(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) {
    return { __firestoreType: 'timestamp', value: value.toISOString() };
  }
  if (typeof value.toDate === 'function') {
    return { __firestoreType: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value.path && typeof value.path === 'string' && value.firestore) {
    return { __firestoreType: 'reference', path: value.path };
  }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && value.constructor?.name === 'GeoPoint') {
    return { __firestoreType: 'geoPoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) {
    return value.map(encodeRestoreValue);
  }
  if (Buffer.isBuffer(value)) {
    return { __firestoreType: 'bytes', base64: value.toString('base64') };
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = encodeRestoreValue(child);
  }
  return out;
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSort(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableSort(value));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function mimeTypeFor(filePath) {
  if (filePath.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (filePath.endsWith('.jsonl')) return 'application/x-ndjson';
  if (filePath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function normalizeObjectPrefix(prefix) {
  return String(prefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

async function fileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

async function uploadArtifactsToGcs({ bucketName, prefix, backupRunId, filePaths }) {
  if (!bucketName) return [];
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
  });
  const storage = google.storage({ version: 'v1', auth });
  const objectPrefix = normalizeObjectPrefix(prefix);
  const uploads = [];
  for (const filePath of filePaths) {
    const objectName = [objectPrefix, backupRunId, path.basename(filePath)].filter(Boolean).join('/');
    const response = await storage.objects.insert({
      bucket: bucketName,
      name: objectName,
      requestBody: {
        name: objectName,
        contentType: mimeTypeFor(filePath),
        metadata: {
          backupRunId,
          sourcePath: filePath,
        },
      },
      media: {
        mimeType: mimeTypeFor(filePath),
        body: createReadStream(filePath),
      },
    });
    uploads.push({
      provider: 'gcs',
      filePath,
      bucket: bucketName,
      object: objectName,
      uri: `gs://${bucketName}/${objectName}`,
      size: await fileSize(filePath),
      generation: response.data.generation || '',
    });
  }
  return uploads;
}

async function findOrCreateDriveFolder(drive, parentId, name) {
  const folderName = sanitizeDriveName(name);
  const response = await drive.files.list({
    q: `'${escapeDriveQueryValue(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQueryValue(folderName)}' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const existing = response.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
    supportsAllDrives: true,
  });
  return created.data.id;
}

async function uploadArtifactsToDrive({ folderId, convertSheets, outputs, filePaths }) {
  if (!folderId) return [];
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });
  const uploads = [];
  const items = outputs
    ? outputs.map((output) => ({
        filePath: output.sheetFilePath,
        folderName: output.driveFolderName,
        fileName: output.driveFileName,
        projectId: output.projectId,
        projectName: output.projectName,
      }))
    : filePaths.map((filePath) => ({ filePath }));
  const folderCache = new Map();
  for (const item of items) {
    const filePath = item.filePath;
    const isSheet = filePath.endsWith('.xlsx');
    let parentId = folderId;
    if (item.folderName) {
      if (!folderCache.has(item.folderName)) {
        folderCache.set(item.folderName, await findOrCreateDriveFolder(drive, folderId, item.folderName));
      }
      parentId = folderCache.get(item.folderName);
    }
    const requestBody = {
      name: item.fileName || path.basename(filePath),
      parents: [parentId],
    };
    if (isSheet && convertSheets) {
      requestBody.name = item.fileName || path.basename(filePath, '.xlsx');
      requestBody.mimeType = 'application/vnd.google-apps.spreadsheet';
    }
    const response = await drive.files.create({
      requestBody,
      media: {
        mimeType: mimeTypeFor(filePath),
        body: createReadStream(filePath),
      },
      fields: 'id,name,mimeType,webViewLink,webContentLink',
      supportsAllDrives: true,
    });
    uploads.push({
      provider: 'drive',
      filePath,
      folderId: parentId,
      folderName: item.folderName || '',
      projectId: item.projectId || '',
      projectName: item.projectName || '',
      id: response.data.id,
      name: response.data.name,
      mimeType: response.data.mimeType,
      url: response.data.webViewLink || response.data.webContentLink || '',
      size: await fileSize(filePath),
    });
  }
  return uploads;
}

async function sendSlackNotification(webhookUrl, payload) {
  if (!webhookUrl) return;
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Slack notification failed: ${response.status} ${text}`);
  }
}

function maskEmail(value) {
  const text = String(value || '');
  const match = text.match(/^([^@]{1,2})[^@]*(@.+)$/);
  return match ? `${match[1]}***${match[2]}` : text;
}

function redactJson(value, keyPath = []) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redactJson(item, keyPath));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    const sensitive = /(email|phone|tel|account|token|secret|password|private|credential|authorization|url)$/.test(lowered)
      || lowered.includes('email')
      || lowered.includes('phone')
      || lowered.includes('token')
      || lowered.includes('secret')
      || lowered.includes('account');
    if (sensitive && typeof child === 'string') {
      out[key] = lowered.includes('email') ? maskEmail(child) : '[REDACTED]';
    } else if (sensitive && child != null) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactJson(child, [...keyPath, key]);
    }
  }
  return out;
}

function truncateCell(value, limit = JSON_PREVIEW_LIMIT) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit - 20)}…[truncated ${text.length}]` : text;
}

function readByPath(data, paths) {
  for (const key of paths) {
    const value = key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), data);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function valueByPath(data, pathParts) {
  return pathParts.reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), data);
}

function cellValue(value) {
  if (value == null) return '';
  if (typeof value === 'object') return truncateCell(stableStringify(normalizeFirestoreValue(value)), 1000);
  return value;
}

function extractCreatedAt(data) {
  return readByPath(data, ['createdAt', 'created_at', 'createdDate']);
}

function extractUpdatedAt(data) {
  return readByPath(data, ['updatedAt', 'updated_at', 'modifiedAt']);
}

function extractDeletedAt(data) {
  return readByPath(data, ['deletedAt', 'trashedAt', 'removedAt']);
}

function docToRecord(doc, collectionName, projectId, extra = {}) {
  const rawData = doc.data() || {};
  const normalizedData = normalizeFirestoreValue(rawData);
  const data = {
    id: normalizedData.id ?? doc.id,
    ...normalizedData,
  };
  const restoreData = {
    id: rawData.id ?? doc.id,
    ...rawData,
  };
  const json = stableStringify(data);
  const jsonHash = sha256(json);
  return {
    docPath: doc.ref.path,
    docId: doc.id,
    collection: collectionName,
    projectId,
    data,
    firestoreData: encodeRestoreValue(restoreData),
    json,
    jsonHash,
    version: data.version ?? '',
    createdAt: extractCreatedAt(data),
    updatedAt: extractUpdatedAt(data),
    deletedAt: extractDeletedAt(data),
    ...extra,
  };
}

async function fetchCollection(db, collectionPath) {
  const snap = await db.collection(collectionPath).get();
  return snap.docs;
}

async function fetchDocsByProjectFields(db, collectionPath, projectId, fields = ['projectId']) {
  const byPath = new Map();
  for (const field of fields) {
    const snap = await db.collection(collectionPath).where(field, '==', projectId).get();
    for (const doc of snap.docs) {
      byPath.set(doc.ref.path, doc);
    }
  }
  return [...byPath.values()];
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

async function fetchDocsByFieldValues(db, collectionPath, fieldName, values) {
  const uniqueValues = [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
  if (uniqueValues.length === 0) return [];
  const byPath = new Map();
  for (const chunk of chunkArray(uniqueValues, 30)) {
    const snap = await db.collection(collectionPath).where(fieldName, 'in', chunk).get();
    for (const doc of snap.docs) {
      byPath.set(doc.ref.path, doc);
    }
  }
  return [...byPath.values()];
}

async function fetchSubcollectionDocs(projectRef, subcollectionName) {
  const snap = await projectRef.collection(subcollectionName).get();
  return snap.docs;
}

function memberBelongsToProject(member, projectId) {
  const data = member.data || {};
  if (data.projectId === projectId) return true;
  if (Array.isArray(data.projectIds) && data.projectIds.includes(projectId)) return true;
  const profile = data.portalProfile || {};
  if (profile.projectId === projectId) return true;
  if (Array.isArray(profile.projectIds) && profile.projectIds.includes(projectId)) return true;
  return false;
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'InnerPlatform backup exporter';
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

function styleWorksheet(worksheet) {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle' };
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columnCount },
  };
}

function addRowsSheet(workbook, sheetName, rows, specificColumns, context, jsonIndexRows) {
  const worksheet = workbook.addWorksheet(sheetName);
  const columns = [
    ...REVIEW_INPUT_COLUMNS,
    ...COMMON_COLUMNS,
    { header: '사업ID_값', key: 'projectIdValue', width: 20 },
    ...specificColumns.map(([header]) => ({ header, key: header, width: Math.min(Math.max(String(header).length + 8, 14), 32) })),
  ];
  worksheet.columns = columns;

  rows.forEach((record, index) => {
    const jsonRef = `${sheetName}!${index + 2}`;
    const redacted = stableStringify(redactJson(record.data));
    const row = {
      inputAction: '유지',
      reviewStatus: '미검수',
      inputMemo: '',
      backupRunId: context.backupRunId,
      tenantId: context.tenantId,
      projectId: record.projectId || context.projectId,
      projectName: context.projectName || '',
      collection: record.collection,
      docPath: record.docPath,
      docId: record.docId,
      schemaVersion: record.data.schemaVersion || '',
      version: record.version || '',
      createdAt: record.createdAt || '',
      updatedAt: record.updatedAt || '',
      deletedAt: record.deletedAt || '',
      hash: record.jsonHash.slice(0, 16),
      jsonPreview: truncateCell(redacted),
      jsonHash: record.jsonHash,
      jsonRef,
      projectIdValue: readByPath(record.data, ['projectId', 'approvedProjectId']) || record.projectId || context.projectId,
    };
    for (const [header, paths] of specificColumns) {
      let value = readByPath(record.data, paths);
      if (header.includes('이메일') && value) value = maskEmail(value);
      row[header] = typeof value === 'object' ? truncateCell(stableStringify(value), 1000) : value;
    }
    worksheet.addRow(row);
    jsonIndexRows.push({
      컬렉션: record.collection,
      사업명: context.projectName || '',
      문서경로: record.docPath,
      문서ID: record.docId,
      JSON해시: record.jsonHash,
      JSON참조: jsonRef,
      마스킹모드: 'sheet-redacted/raw-jsonl',
      바이트크기: Buffer.byteLength(record.json, 'utf8'),
      백업일시: context.createdAt,
    });
  });

  styleWorksheet(worksheet);
  worksheet.dataValidations.add('A2:A10000', {
    type: 'list',
    allowBlank: false,
    formulae: ['"유지,수정,신규,삭제,확인필요"'],
  });
  worksheet.dataValidations.add('B2:B10000', {
    type: 'list',
    allowBlank: false,
    formulae: ['"미검수,확인완료,수정필요,입력완료,제외"'],
  });
}

function addManifestSheet(workbook, context, summaries) {
  const worksheet = workbook.addWorksheet('백업_표지');
  worksheet.columns = [
    { header: '항목', key: 'key', width: 28 },
    { header: '값', key: 'value', width: 90 },
  ];
  const entries = [
    ['백업ID', context.backupRunId],
    ['백업일시', context.createdAt],
    ['백업실행자', context.createdBy],
    ['백업사유', context.reason],
    ['Firebase프로젝트ID', context.firebaseProjectId],
    ['조직ID', context.tenantId],
    ['사업ID', context.projectId || 'GLOBAL'],
    ['사업명', context.projectName || '관리자/global 원장'],
    ['Git커밋', context.gitCommit],
    ['브랜치', context.branch],
    ['Exporter버전', context.exporterVersion],
    ['NativeExport경로', context.nativeExportPath || 'not-created-by-this-script'],
    ['스프레드시트경로', context.sheetFilePath || 'pending'],
    ['JSONL경로', context.jsonlFilePath || 'pending'],
    ['JSONManifest경로', context.jsonManifestPath || 'pending'],
    ['컬렉션수', summaries.length],
    ['문서수', summaries.reduce((sum, item) => sum + item.documentCount, 0)],
    ['마스킹모드', 'spreadsheet-redacted/jsonl-raw'],
    ['재입력방식', '각 탭의 입력액션/검수상태/입력메모를 작성하고 기존 업무 컬럼 값을 수정한다'],
    ['기술컬럼', '문서경로/해시/JSON 원본 참조는 숨김 처리되어 있으며 복구 추적용으로만 사용한다'],
    ['복구검증상태', '정기자동화 제외(hash/diff 검증 기준)'],
  ];
  entries.forEach(([key, value]) => worksheet.addRow({ key, value }));
  worksheet.addRow({});
  worksheet.addRow({ key: '컬렉션', value: '문서수 / 해시집계' });
  summaries.forEach((summary) => {
    worksheet.addRow({
      key: summary.collection,
      value: `${summary.documentCount} / ${summary.hashAggregate}`,
    });
  });
  styleWorksheet(worksheet);
}

function addJsonIndexSheet(workbook, rows) {
  const worksheet = workbook.addWorksheet('JSON_복구원본_목록');
  worksheet.state = 'hidden';
  worksheet.columns = [
    { header: '컬렉션', key: '컬렉션', width: 26 },
    { header: '사업명', key: '사업명', width: 34 },
    { header: '문서경로', key: '문서경로', width: 58 },
    { header: '문서ID', key: '문서ID', width: 28 },
    { header: 'JSON해시', key: 'JSON해시', width: 66 },
    { header: 'JSON참조', key: 'JSON참조', width: 24 },
    { header: '마스킹모드', key: '마스킹모드', width: 24 },
    { header: '바이트크기', key: '바이트크기', width: 14 },
    { header: '백업일시', key: '백업일시', width: 24 },
  ];
  rows.forEach((row) => worksheet.addRow(row));
  styleWorksheet(worksheet);
}

function addDetailRowsSheet(workbook, config, sourceRecords, context) {
  const detailRows = [];
  let maxCellCount = 0;
  for (const record of sourceRecords) {
    const arrayValue = valueByPath(record.data, config.arrayPath) || [];
    if (!Array.isArray(arrayValue)) continue;
    arrayValue.forEach((rowValue, index) => {
      const nestedValue = config.nestedArrayPath ? valueByPath(rowValue, config.nestedArrayPath) : null;
      const nestedRows = Array.isArray(nestedValue) && nestedValue.length > 0 ? nestedValue : [null];
      const cells = config.cellsPath ? valueByPath(rowValue, config.cellsPath) : [];
      if (Array.isArray(cells)) maxCellCount = Math.max(maxCellCount, cells.length);
      nestedRows.forEach((nestedItem, nestedIndex) => {
        detailRows.push({
          record,
          rowValue,
          nestedItem,
          rowIndex: index + 1,
          nestedIndex: nestedIndex + 1,
          cells: Array.isArray(cells) ? cells : [],
        });
      });
    });
  }

  const worksheet = workbook.addWorksheet(config.sheetName);
  const columns = [
    ...REVIEW_INPUT_COLUMNS,
    { header: '백업ID', key: 'backupRunId', width: 26, hidden: true },
    { header: '조직ID', key: 'tenantId', width: 14, hidden: true },
    { header: '사업ID', key: 'projectId', width: 22 },
    { header: '사업명', key: 'projectName', width: 34 },
    { header: '상위탭', key: 'sourceSheetName', width: 20 },
    { header: '상위문서경로', key: 'docPath', width: 52, hidden: true },
    { header: '상위문서ID', key: 'docId', width: 26 },
    { header: '행번호', key: 'rowIndex', width: 10 },
    ...(config.nestedArrayPath ? [{ header: '하위행번호', key: 'nestedIndex', width: 10 }] : []),
    ...config.rowColumns.map(([header]) => ({ header, key: header, width: Math.min(Math.max(String(header).length + 8, 14), 32) })),
    ...(config.nestedColumn ? [{ header: config.nestedColumn, key: config.nestedColumn, width: 18 }] : []),
    ...Array.from({ length: maxCellCount }, (_, index) => ({
      header: `${config.cellPrefix || '셀'}_${String(index + 1).padStart(2, '0')}`,
      key: `cell_${index + 1}`,
      width: 18,
    })),
    { header: '상위JSON해시', key: 'jsonHash', width: 66, hidden: true },
  ];
  worksheet.columns = columns;

  detailRows.forEach((detail) => {
    const row = {
      inputAction: '유지',
      reviewStatus: '미검수',
      inputMemo: '',
      backupRunId: context.backupRunId,
      tenantId: context.tenantId,
      projectId: detail.record.projectId || context.projectId,
      projectName: context.projectName || '',
      sourceSheetName: config.sourceSheetName,
      docPath: detail.record.docPath,
      docId: detail.record.docId,
      rowIndex: detail.rowIndex,
      nestedIndex: detail.nestedIndex,
      jsonHash: detail.record.jsonHash,
    };
    for (const [header, paths] of config.rowColumns) {
      row[header] = cellValue(readByPath(detail.rowValue, paths));
    }
    if (config.nestedColumn) row[config.nestedColumn] = cellValue(detail.nestedItem);
    detail.cells.forEach((value, index) => {
      row[`cell_${index + 1}`] = cellValue(value);
    });
    worksheet.addRow(row);
  });

  styleWorksheet(worksheet);
  worksheet.dataValidations.add('A2:A10000', {
    type: 'list',
    allowBlank: false,
    formulae: ['"유지,수정,신규,삭제,확인필요"'],
  });
  worksheet.dataValidations.add('B2:B10000', {
    type: 'list',
    allowBlank: false,
    formulae: ['"미검수,확인완료,수정필요,입력완료,제외"'],
  });
}

async function collectProjectTabRows(db, tenantId, projectDoc, allMemberRecords) {
  const projectId = projectDoc.id;
  const projectRef = projectDoc.ref;
  const rowsBySheet = new Map();
  for (const tab of PROJECT_TABS) {
    const records = [];
    if (tab.source === 'project-doc') {
      records.push(docToRecord(projectDoc, 'projects', projectId));
    }
    if (tab.source === 'members') {
      records.push(...allMemberRecords.filter((record) => memberBelongsToProject(record, projectId)));
    }
    for (const collectionName of tab.topLevelCollections || []) {
      const docs = await fetchDocsByProjectFields(
        db,
        `orgs/${tenantId}/${collectionName}`,
        projectId,
        tab.projectFields || ['projectId'],
      );
      records.push(...docs.map((doc) => docToRecord(doc, collectionName, projectId)));
    }
    for (const link of tab.linkedTopLevelCollections || []) {
      const sourceDocs = await fetchDocsByProjectFields(
        db,
        `orgs/${tenantId}/${link.sourceCollectionName}`,
        projectId,
        link.sourceProjectFields || ['projectId'],
      );
      const sourceIds = sourceDocs.map((doc) => doc.id);
      const docs = await fetchDocsByFieldValues(
        db,
        `orgs/${tenantId}/${link.collectionName}`,
        link.linkField,
        sourceIds,
      );
      records.push(...docs.map((doc) => docToRecord(doc, link.collectionName, projectId)));
    }
    for (const subcollectionName of tab.subcollections || []) {
      const docs = await fetchSubcollectionDocs(projectRef, subcollectionName);
      records.push(...docs.map((doc) => docToRecord(doc, `projects/${projectId}/${subcollectionName}`, projectId)));
    }
    rowsBySheet.set(tab.sheetName, { tab, records });
  }
  return rowsBySheet;
}

function buildSummaries(rowsBySheet) {
  return [...rowsBySheet.values()].map(({ tab, records }) => ({
    collection: tab.sheetName,
    documentCount: records.length,
    hashAggregate: sha256(records.map((record) => record.jsonHash).sort().join('|')).slice(0, 16),
  }));
}

async function writeProjectBackup({ db, tenantId, projectDoc, allMemberRecords, outputDir, baseContext }) {
  const projectData = normalizeFirestoreValue(projectDoc.data() || {});
  const projectId = projectDoc.id;
  const projectName = projectData.name || projectData.title || projectId;
  const safeProject = sanitizeFileToken(projectId);
  const readableProjectName = sanitizeDriveName(projectName);
  const driveFolderName = readableProjectName;
  const driveFileName = `[MYSCube]${readableProjectName}-${backupDate(baseContext.createdAt)}`;
  const rowsBySheet = await collectProjectTabRows(db, tenantId, projectDoc, allMemberRecords);
  const summaries = buildSummaries(rowsBySheet);
  const jsonRecords = [];
  const jsonIndexRows = [];
  const fileBase = `inner-platform-project-backup-${sanitizeFileToken(tenantId)}-${safeProject}-${compactTimestamp(baseContext.createdAt)}-${baseContext.gitCommit.slice(0, 8)}`;
  const sheetFilePath = path.join(outputDir, `${fileBase}.xlsx`);
  const jsonlFilePath = path.join(outputDir, `${fileBase}.jsonl`);
  const jsonManifestPath = path.join(outputDir, `${fileBase}.manifest.json`);
  const context = {
    ...baseContext,
    projectId,
    projectName,
    sheetFilePath,
    jsonlFilePath,
    jsonManifestPath,
  };
  const workbook = createWorkbook();
  addManifestSheet(workbook, context, summaries);
  for (const { tab, records } of rowsBySheet.values()) {
    addRowsSheet(workbook, tab.sheetName, records, tab.columns || [], context, jsonIndexRows);
    for (const record of records) {
      jsonRecords.push({
        backupRunId: context.backupRunId,
        백업ID: context.backupRunId,
        조직ID: tenantId,
        사업ID: projectId,
        컬렉션: record.collection,
        문서경로: record.docPath,
        문서ID: record.docId,
        JSON해시: record.jsonHash,
        data: record.data,
        firestoreData: record.firestoreData,
      });
    }
  }
  for (const detailConfig of DETAIL_SHEET_CONFIGS) {
    const source = rowsBySheet.get(detailConfig.sourceSheetName);
    if (source) addDetailRowsSheet(workbook, detailConfig, source.records, context);
  }
  addJsonIndexSheet(workbook, jsonIndexRows);
  await fs.writeFile(jsonlFilePath, `${jsonRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
  await fs.writeFile(jsonManifestPath, JSON.stringify({
    ...context,
    summaries,
    documentCount: jsonRecords.length,
    jsonlSha256: sha256(jsonRecords.map((record) => JSON.stringify(record)).join('\n')),
  }, null, 2));
  await workbook.xlsx.writeFile(sheetFilePath);
  return {
    sheetFilePath,
    jsonlFilePath,
    jsonManifestPath,
    documentCount: jsonRecords.length,
    projectId,
    projectName,
    driveFolderName,
    driveFileName,
  };
}

async function writeAdminLedger({ db, tenantId, outputDir, baseContext, projectDocs, allMemberRecords }) {
  const tenantsDocs = await fetchCollection(db, 'tenants');
  const settingsDocs = await fetchCollection(db, `orgs/${tenantId}/settings`);
  const tabs = [
    { sheetName: '조직_원장', records: tenantsDocs.map((doc) => docToRecord(doc, 'tenants', 'GLOBAL')), columns: [['조직ID_값', ['id']], ['조직명', ['name']]] },
    { sheetName: '멤버_원장', records: allMemberRecords, columns: [['UID', ['uid', 'id']], ['이름', ['name', 'displayName']], ['이메일마스킹', ['email']], ['역할', ['role']]] },
    { sheetName: '사업_색인', records: projectDocs.map((doc) => docToRecord(doc, 'projects', doc.id)), columns: [['사업ID_값', ['id']], ['사업명', ['name', 'title']], ['상태', ['status']], ['단계', ['phase']]] },
    { sheetName: '조직_설정', records: settingsDocs.map((doc) => docToRecord(doc, 'settings', 'GLOBAL')), columns: [['설정ID', ['id']], ['수정일', ['updatedAt']]] },
  ];
  const auditDocs = await fetchCollection(db, `orgs/${tenantId}/audit_logs`).catch(() => []);
  tabs.push({
    sheetName: '감사로그_색인',
    records: auditDocs.map((doc) => docToRecord(doc, 'audit_logs', 'GLOBAL')),
    columns: [['액션', ['action']], ['대상유형', ['entityType']], ['대상ID', ['entityId']], ['행위자역할', ['actorRole']], ['요청ID', ['requestId']], ['일시', ['timestamp', 'createdAt']]],
  });

  const summaries = tabs.map((tab) => ({
    collection: tab.sheetName,
    documentCount: tab.records.length,
    hashAggregate: sha256(tab.records.map((record) => record.jsonHash).sort().join('|')).slice(0, 16),
  }));
  const fileBase = `inner-platform-admin-ledger-backup-${sanitizeFileToken(tenantId)}-${compactTimestamp(baseContext.createdAt)}-${baseContext.gitCommit.slice(0, 8)}`;
  const driveFolderName = '00_관리자_원장';
  const driveFileName = `[MYSCube]관리자원장-${backupDate(baseContext.createdAt)}`;
  const context = {
    ...baseContext,
    projectId: 'GLOBAL',
    projectName: '관리자/global 원장',
    sheetFilePath: path.join(outputDir, `${fileBase}.xlsx`),
    jsonlFilePath: path.join(outputDir, `${fileBase}.jsonl`),
    jsonManifestPath: path.join(outputDir, `${fileBase}.manifest.json`),
  };
  const workbook = createWorkbook();
  const jsonIndexRows = [];
  const jsonRecords = [];
  addManifestSheet(workbook, context, summaries);
  for (const tab of tabs) {
    addRowsSheet(workbook, tab.sheetName, tab.records, tab.columns, context, jsonIndexRows);
    for (const record of tab.records) {
      jsonRecords.push({
        backupRunId: context.backupRunId,
        백업ID: context.backupRunId,
        조직ID: tenantId,
        사업ID: 'GLOBAL',
        컬렉션: record.collection,
        문서경로: record.docPath,
        문서ID: record.docId,
        JSON해시: record.jsonHash,
        data: record.data,
        firestoreData: record.firestoreData,
      });
    }
  }
  addJsonIndexSheet(workbook, jsonIndexRows);
  await fs.writeFile(context.jsonlFilePath, `${jsonRecords.map((record) => JSON.stringify(record)).join('\n')}\n`);
  await fs.writeFile(context.jsonManifestPath, JSON.stringify({
    ...context,
    summaries,
    documentCount: jsonRecords.length,
    jsonlSha256: sha256(jsonRecords.map((record) => JSON.stringify(record)).join('\n')),
  }, null, 2));
  await workbook.xlsx.writeFile(context.sheetFilePath);
  return {
    sheetFilePath: context.sheetFilePath,
    jsonlFilePath: context.jsonlFilePath,
    jsonManifestPath: context.jsonManifestPath,
    documentCount: jsonRecords.length,
    projectId: 'GLOBAL',
    projectName: context.projectName,
    driveFolderName,
    driveFileName,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const tenantId = assertTenantId(args.tenantId);
  const firebaseProjectId = resolveProjectId();
  const db = createFirestoreDb({ projectId: firebaseProjectId });
  const createdAt = nowIso();
  const branch = getGitValue(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
  const gitCommit = getGitValue(['rev-parse', 'HEAD'], 'unknown');
  const backupRunId = `backup_${tenantId}_${compactTimestamp(createdAt)}_${gitCommit.slice(0, 8)}`;
  const outputDir = path.resolve(args.outDir, backupRunId);
  await fs.mkdir(outputDir, { recursive: true });

  const projectsSnap = await db.collection(`orgs/${tenantId}/projects`).get();
  let projectDocs = projectsSnap.docs;
  if (!args.includeTrashed) {
    projectDocs = projectDocs.filter((doc) => !doc.data()?.trashedAt);
  }
  if (args.projectIds.length > 0) {
    const wanted = new Set(args.projectIds);
    projectDocs = projectDocs.filter((doc) => wanted.has(doc.id));
    const found = new Set(projectDocs.map((doc) => doc.id));
    const missing = args.projectIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`Project not found in tenant ${tenantId}: ${missing.join(', ')}`);
    }
  }

  const memberDocs = await fetchCollection(db, `orgs/${tenantId}/members`).catch(() => []);
  const allMemberRecords = memberDocs.map((doc) => docToRecord(doc, 'members', 'GLOBAL'));
  const baseContext = {
    backupRunId,
    createdAt,
    createdBy: args.createdBy,
    reason: args.reason,
    firebaseProjectId,
    tenantId,
    gitCommit,
    branch,
    exporterVersion: 'project-sheet-backup-v1',
    nativeExportPath: process.env.NATIVE_EXPORT_PATH || '',
  };

  const outputs = [];
  if (args.includeAdminLedger) {
    outputs.push(await writeAdminLedger({ db, tenantId, outputDir, baseContext, projectDocs, allMemberRecords }));
  }
  for (const projectDoc of projectDocs) {
    outputs.push(await writeProjectBackup({ db, tenantId, projectDoc, allMemberRecords, outputDir, baseContext }));
  }

  const runManifest = {
    backupRunId,
    createdAt,
    tenantId,
    firebaseProjectId,
    branch,
    gitCommit,
    outputDir,
    projectCount: projectDocs.length,
    includeAdminLedger: args.includeAdminLedger,
    outputs,
    uploads: [],
    uploadErrors: [],
  };
  const runManifestPath = path.join(outputDir, `${backupRunId}.run-manifest.json`);
  await fs.writeFile(runManifestPath, JSON.stringify(runManifest, null, 2));

  const artifactPaths = [
    ...outputs.flatMap((output) => [output.sheetFilePath, output.jsonlFilePath, output.jsonManifestPath]),
  ];
  const gcsUploads = await uploadArtifactsToGcs({
    bucketName: args.gcsBucket,
    prefix: args.gcsPrefix,
    backupRunId,
    filePaths: artifactPaths,
  });
  runManifest.uploads.push(...gcsUploads);

  try {
    const driveUploads = await uploadArtifactsToDrive({
      folderId: args.driveFolderId,
      convertSheets: args.driveConvertSheets,
      outputs,
    });
    runManifest.uploads.push(...driveUploads);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runManifest.uploadErrors.push({
      provider: 'drive',
      folderId: args.driveFolderId,
      message,
    });
    console.warn(`[project-sheet-backup] drive upload skipped: ${message}`);
    if (args.driveRequired) throw error;
  }

  await fs.writeFile(runManifestPath, JSON.stringify(runManifest, null, 2));
  const finalManifestUploads = [
    ...(await uploadArtifactsToGcs({
      bucketName: args.gcsBucket,
      prefix: args.gcsPrefix,
      backupRunId,
      filePaths: [runManifestPath],
    })),
  ];
  if (finalManifestUploads.length > 0) {
    runManifest.uploads.push(...finalManifestUploads);
    await fs.writeFile(runManifestPath, JSON.stringify(runManifest, null, 2));
  }

  await sendSlackNotification(args.slackWebhookUrl, {
    text: `InnerPlatform Firestore backup completed: ${backupRunId}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*InnerPlatform Firestore backup completed*\n• 백업ID: \`${backupRunId}\`\n• 조직: \`${tenantId}\`\n• 사업 수: ${projectDocs.length}\n• 산출물: ${outputs.length}\n• 업로드: ${runManifest.uploads.length}`,
        },
      },
    ],
  });

  console.log(`[project-sheet-backup] done tenant=${tenantId} projects=${projectDocs.length} output=${outputDir}`);
  console.log(`[project-sheet-backup] runManifest=${runManifestPath}`);
  if (args.gcsBucket) {
    console.log(`[project-sheet-backup] gcs=gs://${args.gcsBucket}/${normalizeObjectPrefix(args.gcsPrefix)}/${backupRunId}`);
  }
  if (args.driveFolderId) {
    console.log(`[project-sheet-backup] driveFolderId=${args.driveFolderId}`);
  }
}

main().catch(async (error) => {
  console.error(`[project-sheet-backup] ${error instanceof Error ? error.message : String(error)}`);
  const webhookUrl = process.env.BACKUP_SLACK_WEBHOOK_URL || '';
  if (webhookUrl) {
    await sendSlackNotification(webhookUrl, {
      text: `InnerPlatform Firestore backup failed: ${error instanceof Error ? error.message : String(error)}`,
    }).catch((notifyError) => {
      console.error(`[project-sheet-backup] slack notification failed: ${notifyError instanceof Error ? notifyError.message : String(notifyError)}`);
    });
  }
  process.exitCode = 1;
});
