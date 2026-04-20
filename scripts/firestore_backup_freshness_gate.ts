#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateFirestoreBackupFreshness,
  parseFirestoreBackupManifest,
  type FirestoreBackupFreshnessResult,
  type FirestoreBackupManifest,
} from './firestore_backup_freshness';

type FirestoreBackupFreshnessGateResult = {
  generatedAt: string;
  passed: boolean;
  manifestCount: number;
  latestManifest: FirestoreBackupManifest | null;
  evaluation: FirestoreBackupFreshnessResult;
};

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readFiniteNumber(value: unknown, fallback: number, fieldName: string): number {
  const text = readText(value);
  if (!text) return fallback;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return parsed;
}

function readDate(value: string | undefined): Date {
  const candidate = value ? new Date(value) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    throw new Error('now must be a valid date');
  }
  return candidate;
}

export function pickLatestFirestoreBackupManifest(
  manifests: FirestoreBackupManifest[],
): FirestoreBackupManifest | null {
  if (manifests.length === 0) return null;
  return [...manifests].sort((left, right) => (
    new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime()
  ))[0] ?? null;
}

export function buildFirestoreBackupFreshnessGateResult(
  manifests: FirestoreBackupManifest[],
  options: { now: Date | string; maxAgeHours: number },
): FirestoreBackupFreshnessGateResult {
  const latestManifest = pickLatestFirestoreBackupManifest(manifests);
  if (!latestManifest) {
    return {
      generatedAt: new Date(options.now).toISOString(),
      passed: false,
      manifestCount: 0,
      latestManifest: null,
      evaluation: {
        passed: false,
        ageHours: Number.POSITIVE_INFINITY,
        maxAgeHours: options.maxAgeHours,
        reason: 'stale-backup',
      },
    };
  }

  const evaluation = evaluateFirestoreBackupFreshness(latestManifest, options);
  return {
    generatedAt: new Date(options.now).toISOString(),
    passed: evaluation.passed,
    manifestCount: manifests.length,
    latestManifest,
    evaluation,
  };
}

function parseCliArgs(argv: string[]) {
  let manifestDir = '';
  let jsonOutPath = '';
  let nowText = '';
  let maxAgeHours = 24;

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
    if (arg === '--now') {
      nowText = readText(argv[index + 1]);
      if (nowText) index += 1;
      continue;
    }
    if (arg.startsWith('--now=')) {
      nowText = readText(arg.slice('--now='.length));
      continue;
    }
    if (arg === '--max-age-hours') {
      maxAgeHours = readFiniteNumber(argv[index + 1], maxAgeHours, '--max-age-hours');
      if (readText(argv[index + 1])) index += 1;
      continue;
    }
    if (arg.startsWith('--max-age-hours=')) {
      maxAgeHours = readFiniteNumber(arg.slice('--max-age-hours='.length), maxAgeHours, '--max-age-hours');
    }
  }

  return { manifestDir, jsonOutPath, nowText, maxAgeHours };
}

function readManifestsFromDir(manifestDir: string): FirestoreBackupManifest[] {
  return readdirSync(manifestDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => parseFirestoreBackupManifest(JSON.parse(readFileSync(join(manifestDir, entry), 'utf8')) as unknown));
}

function writeGateResult(jsonOutPath: string, result: FirestoreBackupFreshnessGateResult) {
  if (!jsonOutPath) return;
  mkdirSync(dirname(jsonOutPath), { recursive: true });
  writeFileSync(jsonOutPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

function runCli(): void {
  const { manifestDir, jsonOutPath, nowText, maxAgeHours } = parseCliArgs(process.argv.slice(2));
  if (!manifestDir) {
    throw new Error('Usage: tsx scripts/firestore_backup_freshness_gate.ts --manifest-dir <dir> [--now <iso>] [--max-age-hours <n>] [--json-out <path>]');
  }

  const now = readDate(nowText || undefined);
  const manifests = readManifestsFromDir(manifestDir);
  const result = buildFirestoreBackupFreshnessGateResult(manifests, {
    now,
    maxAgeHours,
  });

  writeGateResult(jsonOutPath, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.passed ? 0 : 1);
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
