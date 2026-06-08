#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getOrInitAdminApp, resolveProjectId } from '../server/bff/firestore.mjs';

const DEFAULT_TENANT_ID = 'mysc';
const DEFAULT_BATCH_SIZE = 400;
const DEFAULT_REPORT_DIR = 'output/restores/project-sheets';
const PRODUCTION_DATABASE_IDS = new Set(['(default)', 'default']);

function parseArgs(argv) {
  const args = {
    tenantId: process.env.RESTORE_TENANT_ID || DEFAULT_TENANT_ID,
    targetTenantId: process.env.RESTORE_TARGET_TENANT_ID || '',
    backupDir: '',
    backupGcsUri: process.env.RESTORE_BACKUP_GCS_URI || '',
    targetProjectId: process.env.RESTORE_TARGET_PROJECT_ID || resolveProjectId(),
    targetDatabaseId: process.env.RESTORE_TARGET_DATABASE_ID || '(default)',
    projectIds: [],
    collections: [],
    docPaths: [],
    reportDir: process.env.RESTORE_REPORT_DIR || DEFAULT_REPORT_DIR,
    batchSize: Number(process.env.RESTORE_BATCH_SIZE || DEFAULT_BATCH_SIZE),
    apply: false,
    restoreAll: false,
    allowProductionDatabase: false,
    allowDefaultDatabase: false,
    allowExistingTargetData: false,
    allowOverwrite: false,
    confirmBackupRunId: '',
    confirmTargetProject: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--tenant') args.tenantId = next();
    else if (arg === '--target-tenant') args.targetTenantId = next();
    else if (arg === '--backup-dir') args.backupDir = next();
    else if (arg === '--backup-gcs-uri') args.backupGcsUri = next();
    else if (arg === '--target-project') args.targetProjectId = next();
    else if (arg === '--target-database') args.targetDatabaseId = next();
    else if (arg === '--project') args.projectIds.push(next());
    else if (arg === '--collection') args.collections.push(next());
    else if (arg === '--doc-path') args.docPaths.push(next());
    else if (arg === '--report-dir') args.reportDir = next();
    else if (arg === '--batch-size') args.batchSize = Number(next());
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--restore-all') args.restoreAll = true;
    else if (arg === '--allow-production-database') args.allowProductionDatabase = true;
    else if (arg === '--allow-default-database') args.allowDefaultDatabase = true;
    else if (arg === '--allow-existing-target-data') args.allowExistingTargetData = true;
    else if (arg === '--allow-overwrite') args.allowOverwrite = true;
    else if (arg === '--confirm-backup-run-id') args.confirmBackupRunId = next();
    else if (arg === '--confirm-target-project') args.confirmTargetProject = next();
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/restore_project_sheet_backups.mjs --backup-gcs-uri gs://bucket/prefix/backupRunId --target-project PROJECT --target-database DB
  node scripts/restore_project_sheet_backups.mjs --backup-dir output/backups/project-sheets/backup_mysc_... --dry-run

Defaults:
  The command is dry-run unless --apply is provided.

Options:
  --tenant <id>                 Tenant/org id. Defaults to RESTORE_TENANT_ID or mysc.
  --target-tenant <id>          Restore into this tenant/org path. Defaults to --tenant.
  --backup-gcs-uri <gs://...>   GCS backup run prefix containing JSONL and manifest files.
  --backup-dir <dir>            Local backup run directory containing JSONL and manifest files.
  --target-project <id>         Target Firebase/GCP project.
  --target-database <id>        Target Firestore database. Defaults to (default).
  --project <id>                Restore only one project. Repeatable.
  --collection <name>           Restore only one exported collection label. Repeatable.
  --doc-path <path>             Restore only one Firestore document path. Repeatable.
  --restore-all                 Required with --apply when no project/collection/doc filter is provided.
  --apply                       Write planned records to target Firestore. Default policy is create-only.
  --allow-production-database   Required with --apply when target database is (default).
  --allow-default-database      Alias for --allow-production-database for stage/QA default DB rehearsals.
  --allow-existing-target-data  Permit already-identical target docs. Does not permit overwrite.
  --allow-overwrite             Permit overwriting existing target docs. Dangerous. Never use for rehearsal isolation.
  --confirm-backup-run-id <id>  Required with --apply. Must match the loaded backup run id.
  --confirm-target-project <id> Required with --apply. Must match --target-project.
  --report-dir <dir>            Directory for dry-run/apply reports. Defaults to ${DEFAULT_REPORT_DIR}.
  --batch-size <n>              Firestore batch size. Defaults to ${DEFAULT_BATCH_SIZE}.
`);
}

function assertTenantId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(normalized)) {
    throw new Error(`Invalid tenant id: ${value}`);
  }
  return normalized;
}

function rewriteTenantPath(value, sourceTenantId, targetTenantId) {
  if (!targetTenantId || targetTenantId === sourceTenantId || typeof value !== 'string') return value;
  if (value === `orgs/${sourceTenantId}`) return `orgs/${targetTenantId}`;
  if (value.startsWith(`orgs/${sourceTenantId}/`)) {
    return `orgs/${targetTenantId}/${value.slice(`orgs/${sourceTenantId}/`.length)}`;
  }
  if (value === `tenants/${sourceTenantId}`) return `tenants/${targetTenantId}`;
  if (value.startsWith(`tenants/${sourceTenantId}/`)) {
    return `tenants/${targetTenantId}/${value.slice(`tenants/${sourceTenantId}/`.length)}`;
  }
  return value;
}

function rewriteTenantFields(value, sourceTenantId, targetTenantId) {
  if (!targetTenantId || targetTenantId === sourceTenantId) return value;
  if (value == null) return value;
  if (typeof value === 'string') return rewriteTenantPath(value, sourceTenantId, targetTenantId);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => rewriteTenantFields(item, sourceTenantId, targetTenantId));

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'path' && value.__firestoreType === 'reference' && typeof child === 'string') {
      out[key] = rewriteTenantPath(child, sourceTenantId, targetTenantId);
    } else if (['tenantId', 'orgId', 'organizationId', '조직ID'].includes(key) && child === sourceTenantId) {
      out[key] = targetTenantId;
    } else {
      out[key] = rewriteTenantFields(child, sourceTenantId, targetTenantId);
    }
  }
  return out;
}

function rewriteRecordForTarget(record, { tenantId, targetTenantId }) {
  const effectiveTargetTenantId = targetTenantId || tenantId;
  if (effectiveTargetTenantId === tenantId) {
    return {
      ...record,
      sourceDocPath: record['문서경로'],
      targetDocPath: record['문서경로'],
      targetData: record.data,
      targetFirestoreData: record.firestoreData,
    };
  }
  const targetDocPath = rewriteTenantPath(record['문서경로'], tenantId, effectiveTargetTenantId);
  return {
    ...record,
    sourceDocPath: record['문서경로'],
    targetDocPath,
    data: rewriteTenantFields(record.data, tenantId, effectiveTargetTenantId),
    firestoreData: record.firestoreData
      ? rewriteTenantFields(record.firestoreData, tenantId, effectiveTargetTenantId)
      : undefined,
    targetData: rewriteTenantFields(record.data, tenantId, effectiveTargetTenantId),
    targetFirestoreData: record.firestoreData
      ? rewriteTenantFields(record.firestoreData, tenantId, effectiveTargetTenantId)
      : undefined,
  };
}

function normalizeFirestoreValue(value) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
  if (value.path && typeof value.path === 'string' && value.firestore) {
    return { __refPath: value.path };
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = normalizeFirestoreValue(child);
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

function safeReportSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unknown';
}

function parseGsUri(uri) {
  const match = String(uri || '').match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error(`Invalid GCS URI: ${uri}`);
  return {
    bucket: match[1],
    prefix: match[2].replace(/^\/+|\/+$/g, ''),
  };
}

async function listLocalFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listLocalFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

async function materializeGcsBackup(gcsUri) {
  const { bucket, prefix } = parseGsUri(gcsUri);
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/devstorage.read_only'],
  });
  const storage = google.storage({ version: 'v1', auth });
  const list = await storage.objects.list({
    bucket,
    prefix: `${prefix}/`,
    fields: 'items(name,size,md5Hash)',
  });
  const objects = (list.data.items || []).filter((item) => item.name && !item.name.endsWith('/'));
  if (objects.length === 0) throw new Error(`No GCS backup objects found under ${gcsUri}`);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'innerplatform-restore-'));
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  const files = [];
  for (const object of objects) {
    const relativeName = object.name.slice(prefix.length).replace(/^\/+/, '');
    const outPath = path.join(tempDir, relativeName);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.name)}?alt=media`;
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to download gs://${bucket}/${object.name}: ${response.status} ${text}`);
    }
    await fs.writeFile(outPath, Buffer.from(await response.arrayBuffer()));
    files.push(outPath);
  }
  return { dir: tempDir, files, cleanup: async () => fs.rm(tempDir, { recursive: true, force: true }) };
}

function isRunManifestFile(filePath) {
  return filePath.endsWith('.run-manifest.json');
}

function isProjectManifestFile(filePath) {
  return filePath.endsWith('.manifest.json') && !isRunManifestFile(filePath);
}

function jsonlPathForManifest(manifestPath) {
  return manifestPath.replace(/\.manifest\.json$/, '.jsonl');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${filePath}:${index + 1} invalid JSONL: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function computeJsonlSha(records) {
  return sha256(records.map((record) => JSON.stringify(record)).join('\n'));
}

function validateRecord(record, manifest, tenantId) {
  const docPath = record['문서경로'];
  const jsonHash = record['JSON해시'];
  if (!docPath || typeof docPath !== 'string') throw new Error(`Missing 문서경로 in ${manifest.jsonManifestPath || manifest.backupRunId}`);
  if (!jsonHash || typeof jsonHash !== 'string') throw new Error(`Missing JSON해시 for ${docPath}`);
  if (!record.data || typeof record.data !== 'object') throw new Error(`Missing data for ${docPath}`);
  if (record['백업ID'] && record['백업ID'] !== manifest.backupRunId) {
    throw new Error(`Backup id mismatch for ${docPath}: ${record['백업ID']} != ${manifest.backupRunId}`);
  }
  if (record.backupRunId && record.backupRunId !== manifest.backupRunId) {
    throw new Error(`backupRunId mismatch for ${docPath}: ${record.backupRunId} != ${manifest.backupRunId}`);
  }
  if (record['조직ID'] && record['조직ID'] !== tenantId) {
    throw new Error(`Tenant mismatch for ${docPath}: ${record['조직ID']} != ${tenantId}`);
  }
  if (!docPath.startsWith(`orgs/${tenantId}/`) && !docPath.startsWith('tenants/')) {
    throw new Error(`Refusing out-of-tenant document path: ${docPath}`);
  }
  const computedHash = sha256(stableStringify(record.data));
  if (computedHash !== jsonHash) {
    throw new Error(`JSON hash mismatch for ${docPath}: ${computedHash} != ${jsonHash}`);
  }
}

function decodeRestoreValue(value, db) {
  if (value == null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => decodeRestoreValue(item, db));
  if (value.__firestoreType === 'timestamp') {
    return Timestamp.fromDate(new Date(value.value));
  }
  if (value.__firestoreType === 'reference') {
    return db.doc(value.path);
  }
  if (value.__firestoreType === 'geoPoint') {
    return new GeoPoint(value.latitude, value.longitude);
  }
  if (value.__firestoreType === 'bytes') {
    return Buffer.from(value.base64, 'base64');
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = decodeRestoreValue(child, db);
  }
  return out;
}

function restorePayloadForRecord(record, db) {
  const firestoreData = record.targetFirestoreData || record.firestoreData;
  const data = record.targetData || record.data;
  return firestoreData ? decodeRestoreValue(firestoreData, db) : data;
}

async function loadBackupFromDir(dir, tenantId) {
  const files = await listLocalFiles(dir);
  const manifestFiles = files.filter(isProjectManifestFile).sort();
  if (manifestFiles.length === 0) throw new Error(`No project manifest files found in ${dir}`);
  const records = [];
  const manifests = [];
  let backupRunId = '';
  for (const manifestPath of manifestFiles) {
    const manifest = await readJson(manifestPath);
    const jsonlPath = jsonlPathForManifest(manifestPath);
    const jsonlRecords = await readJsonl(jsonlPath);
    if (manifest.jsonlSha256) {
      const actualSha = computeJsonlSha(jsonlRecords);
      if (actualSha !== manifest.jsonlSha256) {
        throw new Error(`JSONL sha mismatch for ${jsonlPath}: ${actualSha} != ${manifest.jsonlSha256}`);
      }
    }
    if (backupRunId && manifest.backupRunId !== backupRunId) {
      throw new Error(`Mixed backup run ids: ${backupRunId} and ${manifest.backupRunId}`);
    }
    backupRunId = manifest.backupRunId;
    for (const record of jsonlRecords) {
      validateRecord(record, manifest, tenantId);
      records.push(record);
    }
    manifests.push({ ...manifest, manifestPath, jsonlPath });
  }
  return {
    backupRunId,
    manifests,
    records,
    sourceDir: dir,
    runManifestPath: files.find(isRunManifestFile) || '',
  };
}

function recordProjectId(record) {
  return record['사업ID'] || record.data?.projectId || record.data?.approvedProjectId || '';
}

function recordCollection(record) {
  return record['컬렉션'] || '';
}

function filterRecords(records, args) {
  const projectSet = new Set(args.projectIds);
  const collectionSet = new Set(args.collections);
  const docPathSet = new Set(args.docPaths);
  return records.filter((record) => {
    if (projectSet.size > 0 && !projectSet.has(recordProjectId(record))) return false;
    if (collectionSet.size > 0 && !collectionSet.has(recordCollection(record))) return false;
    if (docPathSet.size > 0 && !docPathSet.has(record['문서경로'])) return false;
    return true;
  });
}

function recordTargetHash(record) {
  return sha256(stableStringify(record.targetData || record.data));
}

function dedupeRecordsForRestore(records) {
  const byPath = new Map();
  let duplicateCount = 0;
  for (const record of records) {
    const targetPath = record.targetDocPath || record['문서경로'];
    const targetHash = recordTargetHash(record);
    const existing = byPath.get(targetPath);
    if (!existing) {
      byPath.set(targetPath, { record, targetHash, sourcePaths: [record.sourceDocPath || record['문서경로']] });
      continue;
    }
    duplicateCount += 1;
    existing.sourcePaths.push(record.sourceDocPath || record['문서경로']);
    if (existing.targetHash !== targetHash) {
      throw new Error(
        `Conflicting duplicate target document ${targetPath}: ${existing.targetHash} != ${targetHash}`,
      );
    }
  }
  return {
    records: Array.from(byPath.values()).map((entry) => entry.record),
    duplicateCount,
  };
}

function expectedHashForRecord(record, db) {
  return sha256(stableStringify(normalizeFirestoreValue(restorePayloadForRecord(record, db))));
}

function classifyCurrentState(record, currentData, db) {
  const expectedHash = expectedHashForRecord(record, db);
  if (!currentData) return { action: 'create', currentHash: '' };
  const currentHash = sha256(stableStringify(normalizeFirestoreValue(currentData)));
  if (currentHash === expectedHash) return { action: 'skip-identical', currentHash };
  return { action: 'overwrite', currentHash };
}

async function buildRestorePlan({ db, records }) {
  const rows = [];
  for (const record of records) {
    const docPath = record.targetDocPath || record['문서경로'];
    const snapshot = await db.doc(docPath).get();
    const expectedHash = expectedHashForRecord(record, db);
    const state = classifyCurrentState(record, snapshot.exists ? snapshot.data() : null, db);
    rows.push({
      docPath,
      sourceDocPath: record.sourceDocPath || record['문서경로'],
      projectId: recordProjectId(record),
      collection: recordCollection(record),
      docId: record['문서ID'] || path.basename(docPath),
      sourceHash: record['JSON해시'],
      expectedHash,
      ...state,
    });
  }
  return rows;
}

function summarizePlan(planRows) {
  const byAction = {};
  const byCollection = {};
  for (const row of planRows) {
    byAction[row.action] = (byAction[row.action] || 0) + 1;
    byCollection[row.collection] = (byCollection[row.collection] || 0) + 1;
  }
  return {
    total: planRows.length,
    byAction,
    byCollection,
  };
}

function assertApplyAllowed(args, backupRunId, selectedRecordCount) {
  if (!args.apply) return;
  if (selectedRecordCount === 0) throw new Error('Refusing --apply with zero selected records');
  if (!args.confirmBackupRunId || args.confirmBackupRunId !== backupRunId) {
    throw new Error(`--apply requires --confirm-backup-run-id ${backupRunId}`);
  }
  if (!args.confirmTargetProject || args.confirmTargetProject !== args.targetProjectId) {
    throw new Error(`--apply requires --confirm-target-project ${args.targetProjectId}`);
  }
  const hasFilter = args.projectIds.length > 0 || args.collections.length > 0 || args.docPaths.length > 0;
  if (!hasFilter && !args.restoreAll) {
    throw new Error('--apply without project/collection/doc filters requires --restore-all');
  }
  if (PRODUCTION_DATABASE_IDS.has(args.targetDatabaseId) && !args.allowProductionDatabase && !args.allowDefaultDatabase) {
    throw new Error('--apply to (default) database requires --allow-default-database or --allow-production-database');
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > 500) {
    throw new Error('--batch-size must be an integer from 1 to 500');
  }
}

function assertPlanAllowedForApply(args, planRows) {
  if (!args.apply) return;
  const existingRows = planRows.filter((row) => row.action !== 'create');
  const overwriteRows = planRows.filter((row) => row.action === 'overwrite');
  const identicalRows = planRows.filter((row) => row.action === 'skip-identical');
  if (existingRows.length > 0 && !args.allowExistingTargetData && !args.allowOverwrite) {
    throw new Error(
      `Refusing --apply because target already contains ${existingRows.length} selected document(s). ` +
      'Use a new empty restore database, or explicitly pass --allow-existing-target-data/--allow-overwrite after reviewing the dry-run report.',
    );
  }
  if (identicalRows.length > 0 && !args.allowExistingTargetData && !args.allowOverwrite) {
    throw new Error(`Refusing --apply because ${identicalRows.length} selected document(s) already exist in target`);
  }
  if (overwriteRows.length > 0 && !args.allowOverwrite) {
    throw new Error(
      `Refusing --apply because ${overwriteRows.length} selected document(s) would be overwritten. ` +
      'Default restore is create-only to prevent mixing with existing data.',
    );
  }
}

async function applyRestore({ db, records, planRows, batchSize, allowOverwrite }) {
  const rowsByPath = new Map(planRows.map((row) => [row.sourceDocPath || row.docPath, row]));
  const writableRecords = records.filter((record) => {
    const action = rowsByPath.get(record.sourceDocPath || record['문서경로'])?.action;
    return action === 'create' || (action === 'overwrite' && allowOverwrite);
  });
  let written = 0;
  for (let i = 0; i < writableRecords.length; i += batchSize) {
    const batch = db.batch();
    for (const record of writableRecords.slice(i, i + batchSize)) {
      const row = rowsByPath.get(record.sourceDocPath || record['문서경로']);
      const ref = db.doc(record.targetDocPath || record['문서경로']);
      if (row?.action === 'overwrite') {
        batch.set(ref, restorePayloadForRecord(record, db));
      } else {
        batch.create(ref, restorePayloadForRecord(record, db));
      }
      written += 1;
    }
    await batch.commit();
  }
  return { written, skipped: records.length - writableRecords.length };
}

async function verifyAppliedRestore({ db, records }) {
  const mismatches = [];
  for (const record of records) {
    const docPath = record.targetDocPath || record['문서경로'];
    const snapshot = await db.doc(docPath).get();
    const expectedHash = expectedHashForRecord(record, db);
    if (!snapshot.exists) {
      mismatches.push({ docPath, sourceDocPath: record.sourceDocPath || record['문서경로'], reason: 'missing-after-restore', expectedHash, actualHash: '' });
      continue;
    }
    const actualHash = sha256(stableStringify(normalizeFirestoreValue(snapshot.data())));
    if (actualHash !== expectedHash) {
      mismatches.push({ docPath, sourceDocPath: record.sourceDocPath || record['문서경로'], reason: 'hash-mismatch-after-restore', expectedHash, actualHash });
    }
  }
  return { verified: records.length - mismatches.length, mismatches };
}

function createTargetDb({ targetProjectId, targetDatabaseId }) {
  const app = getOrInitAdminApp({ projectId: targetProjectId });
  const db = targetDatabaseId && !PRODUCTION_DATABASE_IDS.has(targetDatabaseId)
    ? getFirestore(app, targetDatabaseId)
    : getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}

async function writeReport({ args, backup, selectedRecords, planRows, applyResult, verifyResult }) {
  const report = {
    createdAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    backupRunId: backup.backupRunId,
    sourceDir: backup.sourceDir,
    targetProjectId: args.targetProjectId,
    targetDatabaseId: args.targetDatabaseId,
    tenantId: args.tenantId,
    targetTenantId: args.targetTenantId || args.tenantId,
    filters: {
      projectIds: args.projectIds,
      collections: args.collections,
      docPaths: args.docPaths,
      restoreAll: args.restoreAll,
    },
    manifestCount: backup.manifests.length,
    loadedRecordCount: backup.records.length,
    selectedRecordCount: args.originalSelectedRecordCount || selectedRecords.length,
    dedupedRecordCount: selectedRecords.length,
    duplicateRecordCount: args.duplicateRecordCount || 0,
    summary: summarizePlan(planRows),
    applyResult,
    verifyResult,
    planRows,
  };
  await fs.mkdir(args.reportDir, { recursive: true });
  const targetSegment = [
    args.targetProjectId,
    args.targetDatabaseId,
    args.targetTenantId || args.tenantId,
  ].map(safeReportSegment).join('__');
  const filePath = path.join(
    args.reportDir,
    `${backup.backupRunId}.${targetSegment}.${args.apply ? 'apply' : 'dry-run'}.restore-report.json`,
  );
  await fs.writeFile(filePath, JSON.stringify(report, null, 2));
  return { report, filePath };
}

export {
  parseArgs,
  parseGsUri,
  safeReportSegment,
  stableStringify,
  sha256,
  computeJsonlSha,
  loadBackupFromDir,
  filterRecords,
  summarizePlan,
  assertApplyAllowed,
  assertPlanAllowedForApply,
  decodeRestoreValue,
  dedupeRecordsForRestore,
  expectedHashForRecord,
  rewriteRecordForTarget,
  rewriteTenantPath,
  restorePayloadForRecord,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  args.tenantId = assertTenantId(args.tenantId);
  args.targetTenantId = args.targetTenantId ? assertTenantId(args.targetTenantId) : args.tenantId;
  if (!args.backupDir && !args.backupGcsUri) {
    throw new Error('Provide --backup-dir or --backup-gcs-uri');
  }
  if (args.backupDir && args.backupGcsUri) {
    throw new Error('Use only one of --backup-dir or --backup-gcs-uri');
  }

  let materialized = null;
  try {
    if (args.backupGcsUri) {
      materialized = await materializeGcsBackup(args.backupGcsUri);
      args.backupDir = materialized.dir;
    }
    const backup = await loadBackupFromDir(path.resolve(args.backupDir), args.tenantId);
    const rewrittenRecords = filterRecords(backup.records, args)
      .map((record) => rewriteRecordForTarget(record, args));
    args.originalSelectedRecordCount = rewrittenRecords.length;
    const deduped = dedupeRecordsForRestore(rewrittenRecords);
    args.duplicateRecordCount = deduped.duplicateCount;
    const selectedRecords = deduped.records;
    assertApplyAllowed(args, backup.backupRunId, selectedRecords.length);
    const db = createTargetDb(args);
    const planRows = await buildRestorePlan({ db, records: selectedRecords });
    assertPlanAllowedForApply(args, planRows);
    const applyResult = args.apply
      ? await applyRestore({
          db,
          records: selectedRecords,
          planRows,
          batchSize: args.batchSize,
          allowOverwrite: args.allowOverwrite,
        })
      : null;
    const verifyResult = args.apply
      ? await verifyAppliedRestore({ db, records: selectedRecords })
      : null;
    const { filePath, report } = await writeReport({
      args,
      backup,
      selectedRecords,
      planRows,
      applyResult,
      verifyResult,
    });
    console.log(`[project-sheet-restore] mode=${report.mode} backupRunId=${backup.backupRunId}`);
    console.log(`[project-sheet-restore] target=${args.targetProjectId}/${args.targetDatabaseId}`);
    console.log(`[project-sheet-restore] selected=${selectedRecords.length} loaded=${backup.records.length}`);
    console.log(`[project-sheet-restore] actions=${JSON.stringify(report.summary.byAction)}`);
    if (verifyResult?.mismatches?.length) {
      console.log(`[project-sheet-restore] verifyMismatches=${verifyResult.mismatches.length}`);
    }
    console.log(`[project-sheet-restore] report=${filePath}`);
  } finally {
    await materialized?.cleanup?.();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`[project-sheet-restore] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
