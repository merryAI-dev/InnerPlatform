import { describe, expect, it } from 'vitest';

import {
  evaluateFirestoreBackupFreshness,
  parseFirestoreBackupManifest,
} from '../../../scripts/firestore_backup_freshness';

describe('firestore backup freshness contract', () => {
  it('normalizes a backup manifest and preserves export evidence fields', () => {
    const manifest = parseFirestoreBackupManifest({
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
    });

    expect(manifest).toEqual({
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
    });
  });

  it('marks a manifest fresh or stale against an explicit max-age budget', () => {
    const manifest = parseFirestoreBackupManifest({
      generatedAt: '2026-04-17T08:09:10.000Z',
      projectId: 'finance-prod',
      databaseId: 'finance-db',
      tier: 'daily',
      bucketUri: 'gs://finance-backups',
      outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
      command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily --project finance-prod --database finance-db --quiet',
      collectionIds: [],
      snapshotTime: '',
      asyncExport: false,
      dryRun: false,
    });

    expect(evaluateFirestoreBackupFreshness(manifest, {
      now: new Date('2026-04-17T10:09:10.000Z'),
      maxAgeHours: 4,
    })).toEqual({
      passed: true,
      ageHours: 2,
      maxAgeHours: 4,
      reason: 'within-budget',
    });

    expect(evaluateFirestoreBackupFreshness(manifest, {
      now: new Date('2026-04-18T09:09:11.000Z'),
      maxAgeHours: 24,
    })).toEqual({
      passed: false,
      ageHours: 25,
      maxAgeHours: 24,
      reason: 'stale-backup',
    });
  });

  it('fails closed when the manifest is dry-run-only or structurally invalid', () => {
    const dryRunManifest = parseFirestoreBackupManifest({
      generatedAt: '2026-04-17T08:09:10.000Z',
      projectId: 'finance-prod',
      databaseId: 'finance-db',
      tier: 'weekly',
      bucketUri: 'gs://finance-backups',
      outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly',
      command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly --project finance-prod --database finance-db --quiet',
      collectionIds: [],
      snapshotTime: '',
      asyncExport: true,
      dryRun: true,
    });

    expect(evaluateFirestoreBackupFreshness(dryRunManifest, {
      now: new Date('2026-04-17T10:09:10.000Z'),
      maxAgeHours: 4,
    })).toEqual({
      passed: false,
      ageHours: 2,
      maxAgeHours: 4,
      reason: 'dry-run-manifest',
    });

    expect(() => parseFirestoreBackupManifest({
      generatedAt: 'not-a-date',
      projectId: 'finance-prod',
      databaseId: 'finance-db',
      tier: 'weekly',
      bucketUri: 'gs://finance-backups',
      outputUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly',
      command: 'gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly --project finance-prod --database finance-db --quiet',
      collectionIds: [],
      snapshotTime: '',
      asyncExport: true,
      dryRun: false,
    })).toThrow(/generatedAt must be an ISO timestamp/i);
  });
});
