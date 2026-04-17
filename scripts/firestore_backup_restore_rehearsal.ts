#!/usr/bin/env node

function readEnvText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveBooleanFlag(rawValue: unknown): boolean {
  return readEnvText(rawValue).toLowerCase() === 'true';
}

type FirestoreBackupManifest = {
  projectId: string;
  databaseId: string;
  outputUriPrefix: string;
  dryRun: boolean;
};

type FirestoreBackupRestoreRehearsalConfig = {
  projectId: string;
  sourceDatabaseId: string;
  restoreDatabaseId: string;
  location: string;
  sourceUriPrefix: string;
  deleteAfterVerify: boolean;
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
