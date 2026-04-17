#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface FirestoreBackupManifest {
  generatedAt: string;
  projectId: string;
  databaseId: string;
  tier: string;
  bucketUri: string;
  outputUriPrefix: string;
  command: string;
  collectionIds: string[];
  snapshotTime: string;
  asyncExport: boolean;
  dryRun: boolean;
}

export interface FirestoreBackupFreshnessResult {
  passed: boolean;
  ageHours: number;
  maxAgeHours: number;
  reason: 'within-budget' | 'stale-backup' | 'dry-run-manifest';
}

function readText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  return value.trim();
}

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function parseIsoTimestamp(value: unknown, fieldName: string): string {
  const text = readText(value, fieldName);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new Error(`${fieldName} must be an ISO timestamp`);
  }
  return text;
}

function parseDateLike(value: Date | string, fieldName: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(readText(value, fieldName));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return parsed;
}

export function parseFirestoreBackupManifest(input: unknown): FirestoreBackupManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('manifest must be an object');
  }

  const candidate = input as Record<string, unknown>;
  return {
    generatedAt: parseIsoTimestamp(candidate.generatedAt, 'generatedAt'),
    projectId: readText(candidate.projectId, 'projectId'),
    databaseId: readText(candidate.databaseId, 'databaseId'),
    tier: readText(candidate.tier, 'tier'),
    bucketUri: readText(candidate.bucketUri, 'bucketUri'),
    outputUriPrefix: readText(candidate.outputUriPrefix, 'outputUriPrefix'),
    command: readText(candidate.command, 'command'),
    collectionIds: Array.isArray(candidate.collectionIds)
      ? candidate.collectionIds.map((value) => readText(value, 'collectionIds[]'))
      : (() => {
          throw new Error('collectionIds must be an array');
        })(),
    snapshotTime: readText(candidate.snapshotTime, 'snapshotTime'),
    asyncExport: readBoolean(candidate.asyncExport, 'asyncExport'),
    dryRun: readBoolean(candidate.dryRun, 'dryRun'),
  };
}

export function evaluateFirestoreBackupFreshness(
  manifest: FirestoreBackupManifest,
  options: { now: Date | string; maxAgeHours: number },
): FirestoreBackupFreshnessResult {
  const now = parseDateLike(options.now, 'now');
  if (!Number.isFinite(options.maxAgeHours)) {
    throw new Error('maxAgeHours must be a finite number');
  }

  const generatedAt = parseDateLike(manifest.generatedAt, 'generatedAt');
  const ageHours = Math.floor((now.getTime() - generatedAt.getTime()) / (60 * 60 * 1000));
  const normalizedAgeHours = Math.max(0, ageHours);

  if (manifest.dryRun) {
    return {
      passed: false,
      ageHours: normalizedAgeHours,
      maxAgeHours: options.maxAgeHours,
      reason: 'dry-run-manifest',
    };
  }

  if (normalizedAgeHours > options.maxAgeHours) {
    return {
      passed: false,
      ageHours: normalizedAgeHours,
      maxAgeHours: options.maxAgeHours,
      reason: 'stale-backup',
    };
  }

  return {
    passed: true,
    ageHours: normalizedAgeHours,
    maxAgeHours: options.maxAgeHours,
    reason: 'within-budget',
  };
}

function runCli(): void {
  const manifestPath = process.argv[2];
  const maxAgeArg = process.argv[3];
  if (!manifestPath) {
    console.error('Usage: tsx scripts/firestore_backup_freshness.ts <manifest.json> [maxAgeHours]');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const manifest = parseFirestoreBackupManifest(raw);
  const maxAgeHours = maxAgeArg ? Number(maxAgeArg) : 24;
  const result = evaluateFirestoreBackupFreshness(manifest, {
    now: new Date(),
    maxAgeHours,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
