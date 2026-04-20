import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildFirestoreBackupFreshnessGateResult,
  pickLatestFirestoreBackupManifest,
} from '../../../scripts/firestore_backup_freshness_gate';

const olderManifest = {
  generatedAt: '2026-04-15T08:09:10.000Z',
  projectId: 'finance-prod',
  databaseId: 'finance-db',
  tier: 'daily',
  bucketUri: 'gs://finance-backups',
  outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/15/2026-04-15T08-09-10Z-daily',
  command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/15/2026-04-15T08-09-10Z-daily --project finance-prod --database finance-db --quiet',
  collectionIds: ['projects'],
  snapshotTime: '',
  asyncExport: false,
  dryRun: false,
} as const;

const newerManifest = {
  ...olderManifest,
  generatedAt: '2026-04-17T08:09:10.000Z',
  outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
  command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily --project finance-prod --database finance-db --quiet',
} as const;

describe('firestore backup freshness gate contract', () => {
  it('picks the latest manifest by generatedAt timestamp', () => {
    const picked = pickLatestFirestoreBackupManifest([olderManifest, newerManifest]);
    expect(picked).toEqual(newerManifest);
  });

  it('builds a passing gate result from the latest fresh manifest', () => {
    const result = buildFirestoreBackupFreshnessGateResult(
      [olderManifest, newerManifest],
      {
        now: '2026-04-17T12:00:00.000Z',
        maxAgeHours: 24,
      },
    );

    expect(result.passed).toBe(true);
    expect(result.latestManifest?.generatedAt).toBe('2026-04-17T08:09:10.000Z');
    expect(result.evaluation.reason).toBe('within-budget');
    expect(result.manifestCount).toBe(2);
  });

  it('writes a machine-readable gate result and fails closed when the latest manifest is stale', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'firestore-backup-freshness-gate-'));
    const jsonOutPath = join(tempDir, 'freshness-gate.json');
    const scriptPath = resolve(process.cwd(), 'scripts/firestore_backup_freshness_gate.ts');

    writeFileSync(join(tempDir, 'manifest-old.json'), `${JSON.stringify({
      ...olderManifest,
      generatedAt: '2026-04-10T08:09:10.000Z',
    }, null, 2)}\n`, 'utf8');

    const result = spawnSync(
      'npx',
      [
        'tsx',
        scriptPath,
        '--manifest-dir',
        tempDir,
        '--now',
        '2026-04-17T12:00:00.000Z',
        '--max-age-hours',
        '24',
        '--json-out',
        jsonOutPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);

    const written = JSON.parse(readFileSync(jsonOutPath, 'utf8')) as {
      passed: boolean;
      manifestCount: number;
      latestManifest: { generatedAt: string } | null;
      evaluation: { reason: string; ageHours: number; maxAgeHours: number };
    };

    expect(written.passed).toBe(false);
    expect(written.manifestCount).toBe(1);
    expect(written.latestManifest?.generatedAt).toBe('2026-04-10T08:09:10.000Z');
    expect(written.evaluation.reason).toBe('stale-backup');
    expect(written.evaluation.maxAgeHours).toBe(24);
    expect(result.stdout).toContain('"passed": false');
  });
});
