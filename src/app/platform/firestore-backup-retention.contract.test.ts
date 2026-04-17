import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  buildFirestoreBackupCleanupArgs,
  buildFirestoreBackupCleanupCommand,
  buildFirestoreBackupRetentionPlan,
  resolveFirestoreBackupRetentionPolicy,
} from '../../../scripts/firestore_backup_retention';

const dailyManifest = {
  generatedAt: '2026-04-17T08:09:10.000Z',
  projectId: 'finance-prod',
  databaseId: 'finance-db',
  tier: 'daily',
  bucketUri: 'gs://finance-backups',
  outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
  command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily --project finance-prod --database finance-db --quiet',
  collectionIds: ['projects'],
  snapshotTime: '',
  asyncExport: false,
  dryRun: false,
} as const;

describe('firestore backup retention contract', () => {
  it('resolves default retention policy and accepts explicit day overrides', () => {
    expect(resolveFirestoreBackupRetentionPolicy({})).toEqual({
      dailyDays: 35,
      weeklyDays: 84,
      monthlyDays: 365,
    });

    expect(resolveFirestoreBackupRetentionPolicy({
      FIRESTORE_BACKUP_RETENTION_DAILY_DAYS: '14',
      FIRESTORE_BACKUP_RETENTION_WEEKLY_DAYS: '56',
      FIRESTORE_BACKUP_RETENTION_MONTHLY_DAYS: '730',
    })).toEqual({
      dailyDays: 14,
      weeklyDays: 56,
      monthlyDays: 730,
    });
  });

  it('builds cleanup commands only for manifests beyond their retention window', () => {
    const plan = buildFirestoreBackupRetentionPlan(
      [
        { ...dailyManifest, generatedAt: '2026-04-17T08:09:10.000Z' },
        {
          ...dailyManifest,
          generatedAt: '2026-02-01T08:09:10.000Z',
          outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily',
        },
      ],
      {
        now: '2026-04-17T09:00:00.000Z',
        policy: resolveFirestoreBackupRetentionPolicy({}),
      },
    );

    expect(plan.totalManifests).toBe(2);
    expect(plan.cleanupCandidates).toHaveLength(1);
    expect(plan.cleanupCandidates[0]?.outputUriPrefix).toBe(
      'gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily',
    );
    expect(buildFirestoreBackupCleanupArgs(plan.cleanupCandidates[0]!)).toEqual([
      'storage',
      'rm',
      '--recursive',
      'gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily/**',
      '--quiet',
    ]);
    expect(buildFirestoreBackupCleanupCommand(plan.cleanupCandidates[0]!)).toBe(
      'gcloud storage rm --recursive gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily/** --quiet',
    );
  });

  it('writes a cleanup plan when the CLI receives --manifest-dir and --json-out', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'firestore-backup-retention-'));
    const jsonOutPath = join(tempDir, 'retention-plan.json');
    const scriptPath = resolve(process.cwd(), 'scripts/firestore_backup_retention.ts');

    writeFileSync(join(tempDir, 'daily-new.json'), `${JSON.stringify(dailyManifest, null, 2)}\n`, 'utf8');
    writeFileSync(
      join(tempDir, 'daily-old.json'),
      `${JSON.stringify({
        ...dailyManifest,
        generatedAt: '2026-02-01T08:09:10.000Z',
        outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily',
      }, null, 2)}\n`,
      'utf8',
    );
    // manifestDir intentionally equals tempDir once files exist
    const result = spawnSync(
      'npx',
      [
        'tsx',
        scriptPath,
        '--manifest-dir',
        tempDir,
        '--dry-run',
        '--json-out',
        jsonOutPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);

    const written = JSON.parse(readFileSync(jsonOutPath, 'utf8')) as {
      totalManifests: number;
      cleanupCandidates: Array<{ outputUriPrefix: string; command: string }>;
    };

    expect(written.totalManifests).toBe(2);
    expect(written.cleanupCandidates).toHaveLength(1);
    expect(written.cleanupCandidates[0]?.outputUriPrefix).toBe(
      'gs://finance-backups/firestore-exports/2026/02/01/2026-02-01T08-09-10Z-daily',
    );
    expect(written.cleanupCandidates[0]?.command).toContain('gcloud storage rm --recursive');
    expect(result.stdout).toContain('"totalManifests": 2');
  });
});
