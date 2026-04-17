#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALID_TIERS = new Set(['daily', 'weekly', 'monthly']);

function readEnvText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveTier(rawTier) {
  const tier = readEnvText(rawTier) || 'daily';
  if (!VALID_TIERS.has(tier)) {
    throw new Error('FIRESTORE_BACKUP_TIER must be daily, weekly, or monthly');
  }
  return tier;
}

function resolveBooleanFlag(rawValue) {
  return readEnvText(rawValue).toLowerCase() === 'true';
}

function resolveDateStamp(now) {
  const iso = (now || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const datePath = iso.slice(0, 10).replace(/-/g, '/');
  return { iso: iso.replace(/:/g, '-'), datePath };
}

export function resolveFirestoreBackupExportConfig(env = process.env, now = new Date()) {
  const projectId = readEnvText(env.FIREBASE_PROJECT_ID) || readEnvText(env.GOOGLE_CLOUD_PROJECT);
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required');
  }

  const bucketUri = readEnvText(env.FIRESTORE_BACKUP_BUCKET);
  if (!bucketUri.startsWith('gs://')) {
    throw new Error('FIRESTORE_BACKUP_BUCKET must start with gs://');
  }

  const tier = resolveTier(env.FIRESTORE_BACKUP_TIER);
  const databaseId = readEnvText(env.FIRESTORE_DATABASE_ID) || '(default)';
  const collectionIds = readEnvText(env.FIRESTORE_BACKUP_COLLECTION_IDS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const snapshotTime = readEnvText(env.FIRESTORE_BACKUP_SNAPSHOT_TIME);
  const asyncExport = resolveBooleanFlag(env.FIRESTORE_BACKUP_ASYNC);
  const dryRun = resolveBooleanFlag(env.FIRESTORE_BACKUP_DRY_RUN);
  const stamp = resolveDateStamp(now);

  return {
    projectId,
    bucketUri,
    databaseId,
    tier,
    collectionIds,
    snapshotTime,
    asyncExport,
    dryRun,
    now: now || new Date(),
    stamp,
  };
}

export function buildFirestoreBackupExportPrefix(config) {
  const stamp = config?.stamp || resolveDateStamp(config?.now || new Date());
  return `${config.bucketUri}/firestore-exports/${stamp.datePath}/${stamp.iso}-${config.tier}`;
}

export function buildFirestoreBackupExportCommand(config) {
  const prefix = buildFirestoreBackupExportPrefix(config);
  const parts = [
    'gcloud',
    'firestore',
    'export',
    prefix,
    '--project',
    config.projectId,
    '--database',
    config.databaseId,
  ];

  if (Array.isArray(config.collectionIds) && config.collectionIds.length > 0) {
    parts.push('--collection-ids', config.collectionIds.map((value) => `'${value}'`).join(','));
  }

  if (config.snapshotTime) {
    parts.push('--snapshot-time', `'${config.snapshotTime}'`);
  }

  if (config.asyncExport) {
    parts.push('--async');
  }

  parts.push('--quiet');
  return parts.join(' ');
}

export function buildFirestoreBackupExportArgs(config) {
  const prefix = buildFirestoreBackupExportPrefix(config);
  return [
    'firestore',
    'export',
    prefix,
    '--project',
    config.projectId,
    '--database',
    config.databaseId,
    ...(Array.isArray(config.collectionIds) && config.collectionIds.length > 0
      ? ['--collection-ids', config.collectionIds.join(',')]
      : []),
    ...(config.snapshotTime ? ['--snapshot-time', config.snapshotTime] : []),
    ...(config.asyncExport ? ['--async'] : []),
    '--quiet',
  ];
}

async function runCli() {
  const args = process.argv.slice(2);
  const dryRunArg = args.includes('--dry-run');
  const config = resolveFirestoreBackupExportConfig(process.env, new Date());
  const command = buildFirestoreBackupExportCommand(config);
  const shouldDryRun = dryRunArg || config.dryRun;

  if (shouldDryRun) {
    console.log(command);
    return;
  }

  const child = spawn('gcloud', buildFirestoreBackupExportArgs(config), { stdio: 'inherit' });

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`gcloud firestore export exited with code ${code}`));
    });
  });
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  runCli().catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
}
