import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

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

  it('writes a machine-readable rehearsal plan when the CLI receives --manifest and --json-out', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'firestore-restore-rehearsal-'));
    const manifestPath = join(tempDir, 'backup-manifest.json');
    const jsonOutPath = join(tempDir, 'restore-rehearsal-plan.json');
    const scriptPath = resolve(process.cwd(), 'scripts/firestore_backup_restore_rehearsal.ts');

    writeFileSync(manifestPath, `${JSON.stringify(backupManifest, null, 2)}\n`, 'utf8');

    const result = spawnSync(
      'npx',
      [
        'tsx',
        scriptPath,
        '--manifest',
        manifestPath,
        '--dry-run',
        '--json-out',
        jsonOutPath,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          FIRESTORE_RESTORE_LOCATION: 'asia-northeast3',
          FIRESTORE_RESTORE_DATABASE_ID: 'reh-finance-20260417',
          FIRESTORE_RESTORE_DELETE_AFTER_VERIFY: 'true',
        },
      },
    );

    expect(result.status).toBe(0);

    const written = JSON.parse(readFileSync(jsonOutPath, 'utf8')) as {
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

    expect(written.projectId).toBe('finance-prod');
    expect(written.sourceDatabaseId).toBe('finance-db');
    expect(written.restoreDatabaseId).toBe('reh-finance-20260417');
    expect(written.location).toBe('asia-northeast3');
    expect(written.sourceUriPrefix).toBe(backupManifest.outputUriPrefix);
    expect(written.deleteAfterVerify).toBe(true);
    expect(written.createDatabaseCommand).toContain('gcloud firestore databases create');
    expect(written.importCommand).toContain('gcloud firestore import');
    expect(written.deleteDatabaseCommand).toContain('gcloud firestore databases delete');
    expect(result.stdout).toContain('"restoreDatabaseId": "reh-finance-20260417"');
  });
});
