import { describe, expect, it } from 'vitest';

import {
  buildFirestoreBackupExportCommand,
  buildFirestoreBackupExportArgs,
  buildFirestoreBackupExportPrefix,
  resolveFirestoreBackupExportConfig,
} from '../../../scripts/firestore_backup_export';

describe('firestore GCS backup export contract', () => {
  it('resolves the required config and normalizes the daily export prefix', () => {
    const config = resolveFirestoreBackupExportConfig({
      FIREBASE_PROJECT_ID: 'inner-platform-live-20260316',
      FIRESTORE_BACKUP_BUCKET: 'gs://inner-platform-backups',
    }, new Date('2026-04-17T08:09:10.000Z'));

    expect(config).toMatchObject({
      projectId: 'inner-platform-live-20260316',
      databaseId: '(default)',
      bucketUri: 'gs://inner-platform-backups',
      tier: 'daily',
    });

    expect(buildFirestoreBackupExportPrefix(config)).toBe(
      'gs://inner-platform-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
    );
  });

  it('supports weekly and monthly export tiers with explicit database and collections', () => {
    const weekly = resolveFirestoreBackupExportConfig({
      GOOGLE_CLOUD_PROJECT: 'finance-stage',
      FIRESTORE_BACKUP_BUCKET: 'gs://finance-backups',
      FIRESTORE_BACKUP_TIER: 'weekly',
      FIRESTORE_DATABASE_ID: 'finance-db',
      FIRESTORE_BACKUP_COLLECTION_IDS: 'projects,weekly_submissions,cashflow_weeks',
    }, new Date('2026-04-17T08:09:10.000Z'));

    expect(weekly.tier).toBe('weekly');
    expect(weekly.collectionIds).toEqual(['projects', 'weekly_submissions', 'cashflow_weeks']);

    const monthly = resolveFirestoreBackupExportConfig({
      GOOGLE_CLOUD_PROJECT: 'finance-stage',
      FIRESTORE_BACKUP_BUCKET: 'gs://finance-backups',
      FIRESTORE_BACKUP_TIER: 'monthly',
      FIRESTORE_DATABASE_ID: 'finance-db',
    }, new Date('2026-04-17T08:09:10.000Z'));

    expect(buildFirestoreBackupExportPrefix(monthly)).toBe(
      'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-monthly',
    );
  });

  it('builds a gcloud export command with database, collection ids, and async flags', () => {
    const config = resolveFirestoreBackupExportConfig({
      FIREBASE_PROJECT_ID: 'finance-prod',
      FIRESTORE_BACKUP_BUCKET: 'gs://finance-backups',
      FIRESTORE_DATABASE_ID: 'finance-db',
      FIRESTORE_BACKUP_TIER: 'weekly',
      FIRESTORE_BACKUP_COLLECTION_IDS: 'projects,weekly_submissions',
      FIRESTORE_BACKUP_ASYNC: 'true',
      FIRESTORE_BACKUP_SNAPSHOT_TIME: '2026-04-17T08:00:00.00Z',
    }, new Date('2026-04-17T08:09:10.000Z'));

    expect(buildFirestoreBackupExportCommand(config)).toBe(
      "gcloud firestore export gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly --project finance-prod --database finance-db --collection-ids 'projects','weekly_submissions' --snapshot-time '2026-04-17T08:00:00.00Z' --async --quiet",
    );

    expect(buildFirestoreBackupExportArgs(config)).toEqual([
      'firestore',
      'export',
      'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-weekly',
      '--project',
      'finance-prod',
      '--database',
      'finance-db',
      '--collection-ids',
      'projects,weekly_submissions',
      '--snapshot-time',
      '2026-04-17T08:00:00.00Z',
      '--async',
      '--quiet',
    ]);
  });

  it('fails closed when project, bucket, or tier are invalid', () => {
    expect(() => resolveFirestoreBackupExportConfig({
      FIRESTORE_BACKUP_BUCKET: 'gs://finance-backups',
    })).toThrow(/FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT/i);

    expect(() => resolveFirestoreBackupExportConfig({
      FIREBASE_PROJECT_ID: 'finance-prod',
      FIRESTORE_BACKUP_BUCKET: 'finance-backups',
    })).toThrow(/FIRESTORE_BACKUP_BUCKET must start with gs:\/\//i);

    expect(() => resolveFirestoreBackupExportConfig({
      FIREBASE_PROJECT_ID: 'finance-prod',
      FIRESTORE_BACKUP_BUCKET: 'gs://finance-backups',
      FIRESTORE_BACKUP_TIER: 'quarterly',
    })).toThrow(/FIRESTORE_BACKUP_TIER must be daily, weekly, or monthly/i);
  });
});
