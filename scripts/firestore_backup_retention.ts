#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFirestoreBackupManifest, type FirestoreBackupManifest } from './firestore_backup_freshness';

type FirestoreBackupRetentionPolicy = {
  dailyDays: number;
  weeklyDays: number;
  monthlyDays: number;
};

type FirestoreBackupRetentionCandidate = FirestoreBackupManifest & {
  ageDays: number;
  command: string;
};

type FirestoreBackupRetentionPlan = {
  generatedAt: string;
  totalManifests: number;
  keptManifests: number;
  cleanupCandidates: FirestoreBackupRetentionCandidate[];
  policy: FirestoreBackupRetentionPolicy;
};

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPositiveInteger(value: unknown, fallback: number, fieldName: string): number {
  const text = readText(value);
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid manifest generatedAt: ${value}`);
  }
  return parsed;
}

function resolveRetentionDays(policy: FirestoreBackupRetentionPolicy, tier: string): number {
  if (tier === 'daily') return policy.dailyDays;
  if (tier === 'weekly') return policy.weeklyDays;
  if (tier === 'monthly') return policy.monthlyDays;
  return Number.POSITIVE_INFINITY;
}

function normalizeStoragePrefix(prefix: string): string {
  return prefix.replace(/\/+$/, '');
}

export function resolveFirestoreBackupRetentionPolicy(
  env: Record<string, unknown> = process.env,
): FirestoreBackupRetentionPolicy {
  return {
    dailyDays: readPositiveInteger(env.FIRESTORE_BACKUP_RETENTION_DAILY_DAYS, 35, 'FIRESTORE_BACKUP_RETENTION_DAILY_DAYS'),
    weeklyDays: readPositiveInteger(env.FIRESTORE_BACKUP_RETENTION_WEEKLY_DAYS, 84, 'FIRESTORE_BACKUP_RETENTION_WEEKLY_DAYS'),
    monthlyDays: readPositiveInteger(env.FIRESTORE_BACKUP_RETENTION_MONTHLY_DAYS, 365, 'FIRESTORE_BACKUP_RETENTION_MONTHLY_DAYS'),
  };
}

export function buildFirestoreBackupCleanupArgs(manifest: Pick<FirestoreBackupManifest, 'outputUriPrefix'>): string[] {
  return [
    'storage',
    'rm',
    '--recursive',
    `${normalizeStoragePrefix(manifest.outputUriPrefix)}/**`,
    '--quiet',
  ];
}

export function buildFirestoreBackupCleanupCommand(
  manifest: Pick<FirestoreBackupManifest, 'outputUriPrefix'>,
): string {
  return ['gcloud', ...buildFirestoreBackupCleanupArgs(manifest)].join(' ');
}

export function buildFirestoreBackupRetentionPlan(
  manifests: FirestoreBackupManifest[],
  options: { now: Date | string; policy: FirestoreBackupRetentionPolicy },
): FirestoreBackupRetentionPlan {
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now);
  if (Number.isNaN(now.getTime())) {
    throw new Error('now must be a valid date');
  }

  const cleanupCandidates = manifests.flatMap((manifest) => {
    if (manifest.dryRun) return [];
    const retentionDays = resolveRetentionDays(options.policy, manifest.tier);
    if (!Number.isFinite(retentionDays)) return [];

    const ageDays = Math.floor((now.getTime() - parseDate(manifest.generatedAt).getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays <= retentionDays) return [];

    return [{
      ...manifest,
      ageDays: Math.max(0, ageDays),
      command: buildFirestoreBackupCleanupCommand(manifest),
    }];
  });

  return {
    generatedAt: now.toISOString(),
    totalManifests: manifests.length,
    keptManifests: manifests.length - cleanupCandidates.length,
    cleanupCandidates,
    policy: options.policy,
  };
}

function parseCliArgs(argv: string[]) {
  let manifestDir = '';
  let jsonOutPath = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest-dir') {
      manifestDir = readText(argv[index + 1]);
      if (manifestDir) index += 1;
      continue;
    }
    if (arg.startsWith('--manifest-dir=')) {
      manifestDir = readText(arg.slice('--manifest-dir='.length));
      continue;
    }
    if (arg === '--json-out') {
      jsonOutPath = readText(argv[index + 1]);
      if (jsonOutPath) index += 1;
      continue;
    }
    if (arg.startsWith('--json-out=')) {
      jsonOutPath = readText(arg.slice('--json-out='.length));
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  return { manifestDir, jsonOutPath, dryRun };
}

function readManifestsFromDir(manifestDir: string): FirestoreBackupManifest[] {
  return readdirSync(manifestDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => parseFirestoreBackupManifest(JSON.parse(readFileSync(join(manifestDir, entry), 'utf8')) as unknown));
}

function writeRetentionPlan(jsonOutPath: string, plan: FirestoreBackupRetentionPlan) {
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
  const { manifestDir, jsonOutPath, dryRun } = parseCliArgs(process.argv.slice(2));
  if (!manifestDir) {
    throw new Error('Usage: tsx scripts/firestore_backup_retention.ts --manifest-dir <dir> [--dry-run] [--json-out <plan.json>]');
  }

  const manifests = readManifestsFromDir(manifestDir);
  const plan = buildFirestoreBackupRetentionPlan(manifests, {
    now: new Date(),
    policy: resolveFirestoreBackupRetentionPolicy(process.env),
  });

  writeRetentionPlan(jsonOutPath, plan);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }

  for (const candidate of plan.cleanupCandidates) {
    await runGcloudCommand(buildFirestoreBackupCleanupArgs(candidate));
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
