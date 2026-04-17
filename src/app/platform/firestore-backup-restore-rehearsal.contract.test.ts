import { describe, expect, it } from 'vitest';

import {
  buildFirestoreRestoreCreateDatabaseArgs,
  buildFirestoreRestoreDeleteDatabaseArgs,
  buildFirestoreRestoreImportArgs,
  resolveFirestoreBackupRestoreRehearsalConfig,
} from '../../../scripts/firestore_backup_restore_rehearsal';

const backupManifest = {
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

describe('firestore backup restore rehearsal contract', () => {
  it('resolves restore rehearsal config from a valid backup manifest and explicit staging env', () => {
    const config = resolveFirestoreBackupRestoreRehearsalConfig(
      {
        FIRESTORE_RESTORE_LOCATION: 'asia-northeast3',
        FIRESTORE_RESTORE_DATABASE_ID: 'reh-finance-20260417',
        FIRESTORE_RESTORE_DELETE_AFTER_VERIFY: 'true',
      },
      backupManifest,
    );

    expect(config).toEqual({
      projectId: 'finance-prod',
      sourceDatabaseId: 'finance-db',
      restoreDatabaseId: 'reh-finance-20260417',
      location: 'asia-northeast3',
      sourceUriPrefix: 'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
      deleteAfterVerify: true,
    });
  });

  it('builds create, import, and delete commands for the staging restore rehearsal', () => {
    const config = resolveFirestoreBackupRestoreRehearsalConfig(
      {
        FIRESTORE_RESTORE_LOCATION: 'asia-northeast3',
        FIRESTORE_RESTORE_DATABASE_ID: 'reh-finance-20260417',
        FIRESTORE_RESTORE_DELETE_AFTER_VERIFY: 'true',
      },
      backupManifest,
    );

    expect(buildFirestoreRestoreCreateDatabaseArgs(config)).toEqual([
      'firestore',
      'databases',
      'create',
      '--project',
      'finance-prod',
      '--database',
      'reh-finance-20260417',
      '--location',
      'asia-northeast3',
      '--quiet',
    ]);

    expect(buildFirestoreRestoreImportArgs(config)).toEqual([
      'firestore',
      'import',
      'gs://finance-backups/firestore-exports/2026/04/17/2026-04-17T08-09-10Z-daily',
      '--project',
      'finance-prod',
      '--database',
      'reh-finance-20260417',
      '--quiet',
    ]);

    expect(buildFirestoreRestoreDeleteDatabaseArgs(config)).toEqual([
      'firestore',
      'databases',
      'delete',
      '--project',
      'finance-prod',
      '--database',
      'reh-finance-20260417',
      '--quiet',
    ]);
  });

  it('fails closed when restore location is missing or the backup manifest is dry-run only', () => {
    expect(() =>
      resolveFirestoreBackupRestoreRehearsalConfig({}, backupManifest),
    ).toThrow(/FIRESTORE_RESTORE_LOCATION is required/i);

    expect(() =>
      resolveFirestoreBackupRestoreRehearsalConfig(
        {
          FIRESTORE_RESTORE_LOCATION: 'asia-northeast3',
        },
        {
          ...backupManifest,
          dryRun: true,
        },
      ),
    ).toThrow(/cannot restore from a dry-run backup manifest/i);
  });
});
