#!/usr/bin/env npx tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type JsonMap = Record<string, unknown>;

export interface LiveCutoverManifest {
  orgId: string;
  projectIds: string[];
  memberUids: string[];
  projectRequestIds: string[];
  includeProjectRequests: boolean;
  includeProjectSubcollections: boolean;
  includeWeeklySubmissionStatus: boolean;
  includeCashflowWeeks: boolean;
  includeComments: boolean;
  includeEvidences: boolean;
  includeAuditLogs: boolean;
  includeContractStorage: boolean;
}

interface ProjectLike {
  id: string;
  name?: string;
  officialContractName?: string;
  clientOrg?: string;
  status?: string;
  phase?: string;
  createdAt?: string;
}

interface ProjectDiscoveryEntry {
  id: string;
  name: string;
  officialContractName: string;
  clientOrg: string;
  status: string;
  phase: string;
  createdAt: string;
  likelyTestData: boolean;
  reasons: string[];
}

interface PlannedDoc {
  path: string;
  data: JsonMap;
}

interface MigrationPlan {
  docs: PlannedDoc[];
  storagePaths: string[];
  summary: Record<string, number>;
}

const DEFAULT_SUBCOLLECTIONS = [
  'expense_sheets',
  'bank_statements',
  'budget_summary',
  'budget_code_book',
] as const;

const args = process.argv.slice(2);

if (isEntrypoint()) {
  main().catch((error) => {
    console.error('❌ live cutover failed:', error);
    process.exit(1);
  });
}

async function main() {
  const command = args[0];
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'discover') {
    await runDiscover();
    return;
  }

  if (command === 'migrate') {
    await runMigrate();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function runDiscover() {
  loadEnvFiles([resolve('.env'), resolve('.env.local')]);
  const orgId = getFlagValue('--org') || process.env.SOURCE_DEFAULT_ORG_ID || process.env.VITE_DEFAULT_ORG_ID || 'mysc';
  const sourceProjectId = requiredValue(
    getFlagValue('--source-project') || process.env.SOURCE_FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    'SOURCE_FIREBASE_PROJECT_ID or --source-project',
  );
  const outPath = getFlagValue('--out');

  const admin = await import('firebase-admin');
  const sourceApp = initNamedAdminApp(admin.default, 'live-cutover-source', {
    projectId: sourceProjectId,
    envPrefix: 'SOURCE',
  });
  const sourceDb = sourceApp.firestore();

  const projectSnap = await sourceDb.collection(`orgs/${orgId}/projects`).get();
  const discoveries = projectSnap.docs.map((doc) => buildProjectDiscoveryEntry(doc.id, doc.data() || {}));
  discoveries.sort((a, b) => {
    const aScore = a.likelyTestData ? 1 : 0;
    const bScore = b.likelyTestData ? 1 : 0;
    if (aScore !== bScore) return aScore - bScore;
    return safeLocaleCompare(a.name || a.officialContractName || a.id, b.name || b.officialContractName || b.id);
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceProjectId,
    orgId,
    totalProjects: discoveries.length,
    likelyLiveCount: discoveries.filter((item) => !item.likelyTestData).length,
    likelyTestCount: discoveries.filter((item) => item.likelyTestData).length,
    projects: discoveries,
  };

  console.log(`🔎 Source Firebase project: ${sourceProjectId}`);
  console.log(`🏢 Org: ${orgId}`);
  console.log(`📁 Projects: ${discoveries.length}`);
  console.log(`   - likely live: ${payload.likelyLiveCount}`);
  console.log(`   - likely test: ${payload.likelyTestCount}`);
  console.log('');
  discoveries.slice(0, 50).forEach((item) => {
    const label = item.likelyTestData ? 'TEST?' : 'LIVE?';
    const reason = item.reasons.length ? ` | ${item.reasons.join(', ')}` : '';
    console.log(`- [${label}] ${item.id} | ${item.name || item.officialContractName || '(unnamed)'}${reason}`);
  });
  if (discoveries.length > 50) {
    console.log(`... ${discoveries.length - 50} more`);
  }

  if (outPath) {
    const resolvedOut = resolve(outPath);
    mkdirSync(dirname(resolvedOut), { recursive: true });
    writeFileSync(resolvedOut, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`\n📝 Discovery written to ${resolvedOut}`);
  }
}

async function runMigrate() {
  loadEnvFiles([resolve('.env'), resolve('.env.local')]);
  const manifestPath = requiredValue(getFlagValue('--manifest'), '--manifest');
  const commit = args.includes('--commit');
  const sourceProjectId = requiredValue(
    getFlagValue('--source-project') || process.env.SOURCE_FIREBASE_PROJECT_ID,
    'SOURCE_FIREBASE_PROJECT_ID or --source-project',
  );
  const destProjectId = requiredValue(
    getFlagValue('--dest-project') || process.env.DEST_FIREBASE_PROJECT_ID,
    'DEST_FIREBASE_PROJECT_ID or --dest-project',
  );

  const manifest = normalizeManifest(
    JSON.parse(readFileSync(resolve(manifestPath), 'utf8')) as Partial<LiveCutoverManifest>,
  );

  const admin = await import('firebase-admin');
  const sourceApp = initNamedAdminApp(admin.default, 'live-cutover-source', {
    projectId: sourceProjectId,
    envPrefix: 'SOURCE',
  });
  const destApp = initNamedAdminApp(admin.default, 'live-cutover-dest', {
    projectId: destProjectId,
    envPrefix: 'DEST',
  });

  const sourceDb = sourceApp.firestore();
  const destDb = destApp.firestore();

  const plan = await buildMigrationPlan({
    sourceDb,
    orgId: manifest.orgId,
    manifest,
  });

  console.log('🚚 Live cutover plan');
  console.log(`  - source: ${sourceProjectId}`);
  console.log(`  - destination: ${destProjectId}`);
  console.log(`  - orgId: ${manifest.orgId}`);
  console.log(`  - projectIds: ${manifest.projectIds.join(', ')}`);
  console.log(`  - docs: ${plan.docs.length}`);
  console.log(`  - storage objects: ${plan.storagePaths.length}`);
  console.log(
    `  - summary: ${Object.entries(plan.summary)
      .map(([key, value]) => `${key}:${value}`)
      .join(', ')}`,
  );

  if (!commit) {
    console.log('\n🟢 Dry-run only. Add --commit to write the destination project.');
    return;
  }

  await writeDocs(destDb, plan.docs);
  await copyStorageObjects({
    sourceApp,
    destApp,
    sourceProjectId,
    destProjectId,
    storagePaths: plan.storagePaths,
  });

  console.log('\n✅ Live cutover completed.');
}

export function normalizeManifest(input: Partial<LiveCutoverManifest>): LiveCutoverManifest {
  const projectIds = uniqueStrings(input.projectIds);
  if (projectIds.length === 0) {
    throw new Error('Manifest must include at least one projectIds entry');
  }

  return {
    orgId: normalizeString(input.orgId) || 'mysc',
    projectIds,
    memberUids: uniqueStrings(input.memberUids),
    projectRequestIds: uniqueStrings(input.projectRequestIds),
    includeProjectRequests: normalizeBoolean(input.includeProjectRequests, true),
    includeProjectSubcollections: normalizeBoolean(input.includeProjectSubcollections, true),
    includeWeeklySubmissionStatus: normalizeBoolean(input.includeWeeklySubmissionStatus, true),
    includeCashflowWeeks: normalizeBoolean(input.includeCashflowWeeks, true),
    includeComments: normalizeBoolean(input.includeComments, true),
    includeEvidences: normalizeBoolean(input.includeEvidences, true),
    includeAuditLogs: normalizeBoolean(input.includeAuditLogs, false),
    includeContractStorage: normalizeBoolean(input.includeContractStorage, true),
  };
}

export function buildProjectDiscoveryEntry(id: string, raw: JsonMap): ProjectDiscoveryEntry {
  const name = normalizeString(raw.name);
  const officialContractName = normalizeString(raw.officialContractName);
  const clientOrg = normalizeString(raw.clientOrg);
  const status = normalizeString(raw.status);
  const phase = normalizeString(raw.phase);
  const createdAt = normalizeString(raw.createdAt);
  const joined = `${id} ${name} ${officialContractName} ${clientOrg}`.toLowerCase();
  const reasons: string[] = [];

  const keywordRules = [
    { pattern: /test|dummy|demo|sample|staging|qa|fixture|sandbox/, reason: 'english_test_keyword' },
    { pattern: /테스트|더미|샘플|검증|데모|임시|리허설|업로드 검증|qa/, reason: 'korean_test_keyword' },
  ];
  keywordRules.forEach((rule) => {
    if (rule.pattern.test(joined)) reasons.push(rule.reason);
  });
  if (!id.startsWith('p')) reasons.push('non_standard_project_id');
  if (!status && !phase) reasons.push('missing_status_phase');

  return {
    id,
    name,
    officialContractName,
    clientOrg,
    status,
    phase,
    createdAt,
    likelyTestData: reasons.length > 0,
    reasons,
  };
}

export function extractContractStoragePaths(records: Array<JsonMap | null | undefined>): string[] {
  const paths = new Set<string>();
  for (const record of records) {
    if (!record) continue;
    collectStoragePath(paths, record.contractDocument);
    if (record.payload && typeof record.payload === 'object') {
      collectStoragePath(paths, (record.payload as JsonMap).contractDocument);
    }
  }
  return [...paths].sort((a, b) => safeLocaleCompare(a, b));
}

async function buildMigrationPlan(options: {
  sourceDb: FirebaseFirestore.Firestore;
  orgId: string;
  manifest: LiveCutoverManifest;
}): Promise<MigrationPlan> {
  const { sourceDb, orgId, manifest } = options;
  const docs = new Map<string, JsonMap>();
  const summary: Record<string, number> = {};

  const addDoc = (path: string, data: JsonMap) => {
    const existed = docs.has(path);
    docs.set(path, data);
    if (existed) return;
    const collectionKey = summarizeCollectionPath(path);
    summary[collectionKey] = (summary[collectionKey] || 0) + 1;
  };

  const projectRecords: JsonMap[] = [];
  for (const projectId of manifest.projectIds) {
    const ref = sourceDb.doc(`orgs/${orgId}/projects/${projectId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error(`Project not found in source: ${projectId}`);
    }
    const data = stripUndefined(snap.data() || {});
    projectRecords.push(data);
    addDoc(ref.path, data);

    if (manifest.includeProjectSubcollections) {
      for (const subcollection of DEFAULT_SUBCOLLECTIONS) {
        const subSnap = await ref.collection(subcollection).get();
        subSnap.forEach((doc) => {
          addDoc(doc.ref.path, stripUndefined(doc.data() || {}));
        });
      }
    }
  }

  const projectIdSet = new Set(manifest.projectIds);
  const requestsToCopy = new Set(manifest.projectRequestIds);
  const requestRecords: JsonMap[] = [];

  if (manifest.includeProjectRequests || requestsToCopy.size > 0) {
    const requestSnap = await sourceDb.collection(`orgs/${orgId}/project_requests`).get();
    requestSnap.forEach((doc) => {
      const data = stripUndefined(doc.data() || {});
      const approvedProjectId = normalizeString(data.approvedProjectId);
      if (projectIdSet.has(approvedProjectId) || requestsToCopy.has(doc.id)) {
        requestRecords.push(data);
        addDoc(doc.ref.path, data);
      }
    });
  }

  const ledgers = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/ledgers`, manifest.projectIds);
  ledgers.forEach((item) => addDoc(item.path, item.data));

  const transactions = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/transactions`, manifest.projectIds);
  transactions.forEach((item) => addDoc(item.path, item.data));
  const transactionIds = transactions.map((item) => item.id);

  if (manifest.includeWeeklySubmissionStatus) {
    const weekly = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/weekly_submission_status`, manifest.projectIds);
    weekly.forEach((item) => addDoc(item.path, item.data));
  }

  if (manifest.includeCashflowWeeks) {
    const cashflow = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/cashflow_weeks`, manifest.projectIds);
    cashflow.forEach((item) => addDoc(item.path, item.data));
  }

  if (manifest.includeComments) {
    const commentsByProject = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/comments`, manifest.projectIds);
    commentsByProject.forEach((item) => addDoc(item.path, item.data));
    if (transactionIds.length > 0) {
      const commentsByTransaction = await fetchDocsByFieldValues(
        sourceDb,
        `orgs/${orgId}/comments`,
        'transactionId',
        transactionIds,
      );
      commentsByTransaction.forEach((item) => addDoc(item.path, item.data));
    }
  }

  if (manifest.includeEvidences && transactionIds.length > 0) {
    const evidences = await fetchDocsByFieldValues(
      sourceDb,
      `orgs/${orgId}/evidences`,
      'transactionId',
      transactionIds,
    );
    evidences.forEach((item) => addDoc(item.path, item.data));
  }

  if (manifest.includeAuditLogs) {
    const auditLogs = await fetchDocsByProjectId(sourceDb, `orgs/${orgId}/audit_logs`, manifest.projectIds);
    auditLogs.forEach((item) => addDoc(item.path, item.data));
  }

  const memberSnap = await sourceDb.collection(`orgs/${orgId}/members`).get();
  memberSnap.forEach((doc) => {
    const data = stripUndefined(doc.data() || {});
    if (shouldCopyMemberDoc(data, doc.id, projectIdSet, new Set(manifest.memberUids))) {
      addDoc(doc.ref.path, sanitizeMemberDocForProjects(data, projectIdSet));
    }
  });

  const storagePaths = manifest.includeContractStorage
    ? extractContractStoragePaths([...projectRecords, ...requestRecords])
    : [];

  return {
    docs: [...docs.entries()]
      .map(([path, data]) => ({ path, data }))
      .sort((a, b) => safeLocaleCompare(a.path, b.path)),
    storagePaths,
    summary,
  };
}

function shouldCopyMemberDoc(
  data: JsonMap,
  uid: string,
  projectIds: Set<string>,
  explicitMemberUids: Set<string>,
) {
  if (explicitMemberUids.has(uid)) return true;
  const primary = normalizeString(data.projectId);
  if (primary && projectIds.has(primary)) return true;
  const many = Array.isArray(data.projectIds) ? data.projectIds.map((item) => normalizeString(item)).filter(Boolean) : [];
  return many.some((item) => projectIds.has(item));
}

export function sanitizeMemberDocForProjects(data: JsonMap, projectIds: Set<string>) {
  const next = stripUndefined(data);
  const filteredProjectIds = Array.isArray(next.projectIds)
    ? next.projectIds.map((item) => normalizeString(item)).filter((item) => projectIds.has(item))
    : [];
  const currentProjectId = normalizeString(next.projectId);
  const normalizedPrimary = projectIds.has(currentProjectId)
    ? currentProjectId
    : filteredProjectIds[0] || '';

  next.projectIds = filteredProjectIds;
  next.projectId = normalizedPrimary;
  if (next.projectNames && typeof next.projectNames === 'object') {
    next.projectNames = Object.fromEntries(
      Object.entries(next.projectNames as JsonMap).filter(([key]) => projectIds.has(key)),
    );
  }

  if (next.portalProfile && typeof next.portalProfile === 'object') {
    const profile = { ...(next.portalProfile as JsonMap) };
    const profileProjectIds = Array.isArray(profile.projectIds)
      ? profile.projectIds.map((item) => normalizeString(item)).filter((item) => projectIds.has(item))
      : filteredProjectIds;
    const profileNames = profile.projectNames && typeof profile.projectNames === 'object'
      ? Object.fromEntries(
          Object.entries(profile.projectNames as JsonMap).filter(([key]) => projectIds.has(key)),
        )
      : {};
    const profilePrimary = projectIds.has(normalizeString(profile.projectId))
      ? normalizeString(profile.projectId)
      : profileProjectIds[0] || normalizedPrimary;

    profile.projectIds = profileProjectIds;
    profile.projectId = profilePrimary;
    profile.projectNames = profileNames;
    next.portalProfile = profile;
  }

  return next;
}

async function fetchDocsByProjectId(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
  projectIds: string[],
) {
  return fetchDocsByFieldValues(db, collectionPath, 'projectId', projectIds);
}

async function fetchDocsByFieldValues(
  db: FirebaseFirestore.Firestore,
  collectionPath: string,
  field: string,
  values: string[],
) {
  const results = new Map<string, { id: string; path: string; data: JsonMap }>();
  for (const chunk of chunkArray(uniqueStrings(values), 10)) {
    if (chunk.length === 0) continue;
    const snap = await db.collection(collectionPath).where(field, 'in', chunk).get();
    snap.forEach((doc) => {
      results.set(doc.ref.path, {
        id: doc.id,
        path: doc.ref.path,
        data: stripUndefined(doc.data() || {}),
      });
    });
  }
  return [...results.values()];
}

async function writeDocs(db: FirebaseFirestore.Firestore, docs: PlannedDoc[]) {
  const BATCH_SIZE = 300;
  for (let index = 0; index < docs.length; index += BATCH_SIZE) {
    const chunk = docs.slice(index, index + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((item) => {
      batch.set(db.doc(item.path), item.data, { merge: true });
    });
    await batch.commit();
    console.log(`  - wrote batch ${Math.floor(index / BATCH_SIZE) + 1}: ${chunk.length} docs`);
  }
}

async function copyStorageObjects(options: {
  sourceApp: import('firebase-admin/app').App;
  destApp: import('firebase-admin/app').App;
  sourceProjectId: string;
  destProjectId: string;
  storagePaths: string[];
}) {
  const { sourceApp, destApp, sourceProjectId, destProjectId, storagePaths } = options;
  if (storagePaths.length === 0) return;

  const { getStorage } = await import('firebase-admin/storage');
  const sourceBucketName = process.env.SOURCE_FIREBASE_STORAGE_BUCKET || `${sourceProjectId}.firebasestorage.app`;
  const destBucketName = process.env.DEST_FIREBASE_STORAGE_BUCKET || `${destProjectId}.firebasestorage.app`;
  const sourceBucket = getStorage(sourceApp).bucket(sourceBucketName);
  const destBucket = getStorage(destApp).bucket(destBucketName);

  for (const storagePath of storagePaths) {
    await sourceBucket.file(storagePath).copy(destBucket.file(storagePath));
    console.log(`  - copied storage object: ${storagePath}`);
  }
}

function initNamedAdminApp(
  admin: typeof import('firebase-admin').default,
  appName: string,
  options: { projectId: string; envPrefix: 'SOURCE' | 'DEST' },
) {
  const existing = admin.apps.find((app) => app.name === appName);
  if (existing) return existing;

  const serviceAccount = readServiceAccount(options.envPrefix);
  if (serviceAccount) {
    return admin.initializeApp(
      {
        credential: admin.credential.cert(serviceAccount as any),
        projectId: options.projectId,
        storageBucket: process.env[`${options.envPrefix}_FIREBASE_STORAGE_BUCKET`] || undefined,
      },
      appName,
    );
  }

  return admin.initializeApp(
    {
      credential: admin.credential.applicationDefault(),
      projectId: options.projectId,
      storageBucket: process.env[`${options.envPrefix}_FIREBASE_STORAGE_BUCKET`] || undefined,
    },
    appName,
  );
}

function readServiceAccount(prefix: 'SOURCE' | 'DEST') {
  const jsonValue = normalizeString(process.env[`${prefix}_FIREBASE_SERVICE_ACCOUNT_JSON`]);
  if (jsonValue) {
    return normalizeServiceAccount(JSON.parse(jsonValue));
  }

  const base64Value = normalizeString(process.env[`${prefix}_FIREBASE_SERVICE_ACCOUNT_BASE64`]);
  if (base64Value) {
    return normalizeServiceAccount(JSON.parse(Buffer.from(base64Value, 'base64').toString('utf8')));
  }

  const pathValue = normalizeString(process.env[`${prefix}_FIREBASE_SERVICE_ACCOUNT_PATH`]);
  if (pathValue) {
    return normalizeServiceAccount(JSON.parse(readFileSync(resolve(pathValue), 'utf8')));
  }

  return null;
}

function normalizeServiceAccount(raw: JsonMap | null) {
  if (!raw) return null;
  const next = { ...raw };
  if (typeof next.private_key === 'string') {
    next.private_key = next.private_key.replace(/\\n/g, '\n');
  }
  return next;
}

function loadEnvFiles(paths: string[]) {
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key]) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function collectStoragePath(bucket: Set<string>, docValue: unknown) {
  if (!docValue || typeof docValue !== 'object') return;
  const path = normalizeString((docValue as JsonMap).path);
  if (path) bucket.add(path);
}

function summarizeCollectionPath(path: string) {
  const parts = path.split('/');
  return parts[parts.length - 2] || path;
}

function stripUndefined(input: JsonMap): JsonMap {
  return JSON.parse(JSON.stringify(input)) as JsonMap;
}

function requiredValue(value: string | undefined, name: string) {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(`Missing required value: ${name}`);
  return normalized;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown) {
  const items = Array.isArray(values) ? values : [];
  return [...new Set(items.map((item) => normalizeString(item)).filter(Boolean))];
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function safeLocaleCompare(left: string, right: string) {
  return left.localeCompare(right, 'ko');
}

function isEntrypoint() {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return pathToFileURL(resolve(entryArg)).href === import.meta.url;
}

function getFlagValue(flag: string) {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) return undefined;
  return args[index + 1];
}

function printHelp() {
  console.log(`Usage:
  npx tsx scripts/firestore_live_cutover.ts discover --source-project <firebaseProjectId> [--org mysc] [--out file]
  npx tsx scripts/firestore_live_cutover.ts migrate --manifest <manifest.json> --source-project <sourceId> --dest-project <destId> [--commit]

Environment variables:
  SOURCE_FIREBASE_PROJECT_ID
  DEST_FIREBASE_PROJECT_ID
  SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON | SOURCE_FIREBASE_SERVICE_ACCOUNT_BASE64 | SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH
  DEST_FIREBASE_SERVICE_ACCOUNT_JSON   | DEST_FIREBASE_SERVICE_ACCOUNT_BASE64   | DEST_FIREBASE_SERVICE_ACCOUNT_PATH
  SOURCE_FIREBASE_STORAGE_BUCKET
  DEST_FIREBASE_STORAGE_BUCKET

Notes:
  - migrate defaults to dry-run unless --commit is passed.
  - contract PDFs referenced by project/project_request docs are copied when includeContractStorage is true.
`);
}
