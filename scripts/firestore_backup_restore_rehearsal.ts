#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFirestoreBackupManifest, type FirestoreBackupManifest } from './firestore_backup_freshness';

function readEnvText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBooleanFlag(rawValue: unknown): boolean {
  return readEnvText(rawValue).toLowerCase() === 'true';
}

type FirestoreBackupRestoreRehearsalConfig = {
  projectId: string;
  sourceDatabaseId: string;
  restoreDatabaseId: string;
  location: string;
  sourceUriPrefix: string;
  deleteAfterVerify: boolean;
};

type FirestoreBackupRestoreRehearsalPlan = {
  generatedAt: string;
  projectId: string;
  sourceDatabaseId: string;
  restoreDatabaseId: string;
  location: string;
  sourceUriPrefix: string;
  deleteAfterVerify: boolean;
  createDatabaseCommand: string;
  importCommand: string;
  deleteDatabaseCommand: string;
};

export function resolveFirestoreBackupRestoreRehearsalConfig(
  env: Record<string, unknown> = process.env,
  backupManifest: FirestoreBackupManifest,
): FirestoreBackupRestoreRehearsalConfig {
  const location = readEnvText(env.FIRESTORE_RESTORE_LOCATION);
  if (!location) {
    throw new Error('FIRESTORE_RESTORE_LOCATION is required');
  }

  if (backupManifest?.dryRun) {
    throw new Error('cannot restore from a dry-run backup manifest');
  }

  const restoreDatabaseId = readEnvText(env.FIRESTORE_RESTORE_DATABASE_ID);
  if (!restoreDatabaseId) {
    throw new Error('FIRESTORE_RESTORE_DATABASE_ID is required');
  }

  return {
    projectId: readEnvText(backupManifest?.projectId),
    sourceDatabaseId: readEnvText(backupManifest?.databaseId),
    restoreDatabaseId,
    location,
    sourceUriPrefix: readEnvText(backupManifest?.outputUriPrefix),
    deleteAfterVerify: resolveBooleanFlag(env.FIRESTORE_RESTORE_DELETE_AFTER_VERIFY),
  };
}

export function buildFirestoreRestoreCreateDatabaseArgs(
  config: FirestoreBackupRestoreRehearsalConfig,
): string[] {
  return [
    'firestore',
    'databases',
    'create',
    '--project',
    config.projectId,
    '--database',
    config.restoreDatabaseId,
    '--location',
    config.location,
    '--quiet',
  ];
}

function buildGcloudCommand(args: string[]): string {
  return ['gcloud', ...args].join(' ');
}

export function buildFirestoreBackupRestoreRehearsalPlan(
  config: FirestoreBackupRestoreRehearsalConfig,
  now: Date = new Date(),
): FirestoreBackupRestoreRehearsalPlan {
  return {
    generatedAt: now.toISOString(),
    projectId: config.projectId,
    sourceDatabaseId: config.sourceDatabaseId,
    restoreDatabaseId: config.restoreDatabaseId,
    location: config.location,
    sourceUriPrefix: config.sourceUriPrefix,
    deleteAfterVerify: config.deleteAfterVerify,
    createDatabaseCommand: buildGcloudCommand(buildFirestoreRestoreCreateDatabaseArgs(config)),
    importCommand: buildGcloudCommand(buildFirestoreRestoreImportArgs(config)),
    deleteDatabaseCommand: buildGcloudCommand(buildFirestoreRestoreDeleteDatabaseArgs(config)),
  };
}

function parseCliArgs(argv: string[]) {
  let manifestPath = '';
  let jsonOutPath = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') {
      manifestPath = readEnvText(argv[index + 1]);
      if (manifestPath) index += 1;
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      manifestPath = readEnvText(arg.slice('--manifest='.length));
      continue;
    }
    if (arg === '--json-out') {
      jsonOutPath = readEnvText(argv[index + 1]);
      if (jsonOutPath) index += 1;
      continue;
    }
    if (arg.startsWith('--json-out=')) {
      jsonOutPath = readEnvText(arg.slice('--json-out='.length));
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { manifestPath, jsonOutPath, dryRun };
}

function writeRehearsalPlan(jsonOutPath: string, plan: FirestoreBackupRestoreRehearsalPlan) {
  if (!jsonOutPath) return;
  mkdirSync(dirname(jsonOutPath), { recursive: true });
  writeFileSync(jsonOutPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

async function runGcloudCommand(args: string[]): Promise<void> {
  const child = spawn('gcloud', args, { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gcloud ${args.slice(0, 3).join(' ')} exited with code ${code}`));
    });
  });
}

async function runCli(): Promise<void> {
  const { manifestPath, jsonOutPath, dryRun } = parseCliArgs(process.argv.slice(2));
  if (!manifestPath) {
    throw new Error('Usage: tsx scripts/firestore_backup_restore_rehearsal.ts --manifest <backup-manifest.json> [--dry-run] [--json-out <plan.json>]');
  }

  const backupManifest = parseFirestoreBackupManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  const config = resolveFirestoreBackupRestoreRehearsalConfig(process.env, backupManifest);
  const plan = buildFirestoreBackupRestoreRehearsalPlan(config, new Date());

  writeRehearsalPlan(jsonOutPath, plan);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  await runGcloudCommand(buildFirestoreRestoreCreateDatabaseArgs(config));
  await runGcloudCommand(buildFirestoreRestoreImportArgs(config));
  if (config.deleteAfterVerify) {
    await runGcloudCommand(buildFirestoreRestoreDeleteDatabaseArgs(config));
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export function buildFirestoreRestoreImportArgs(
  config: FirestoreBackupRestoreRehearsalConfig,
): string[] {
  return [
    'firestore',
    'import',
    config.sourceUriPrefix,
    '--project',
    config.projectId,
    '--database',
    config.restoreDatabaseId,
    '--quiet',
  ];
}

export function buildFirestoreRestoreDeleteDatabaseArgs(
  config: FirestoreBackupRestoreRehearsalConfig,
): string[] {
  return [
    'firestore',
    'databases',
    'delete',
    '--project',
    config.projectId,
    '--database',
    config.restoreDatabaseId,
    '--quiet',
  ];
}
