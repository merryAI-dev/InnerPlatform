import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
let firestoreSettingsApplied = false;

export function resolveProjectId(env = process.env) {
  return env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || 'demo-mysc';
}

export function isFirestoreEmulatorEnabled(env = process.env) {
  return !!env.FIRESTORE_EMULATOR_HOST;
}

export function getOrInitAdminApp({ projectId } = {}) {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const resolvedProjectId = projectId || resolveProjectId();
  const useEmulator = isFirestoreEmulatorEnabled();

  if (useEmulator) {
    return initializeApp({ projectId: resolvedProjectId });
  }

  try {
    return initializeApp({
      projectId: resolvedProjectId,
      credential: applicationDefault(),
    });
  } catch {
    return initializeApp({ projectId: resolvedProjectId });
  }
}

export function createFirestoreDb(options = {}) {
  const app = getOrInitAdminApp(options);
  const db = getFirestore(app);
  if (!firestoreSettingsApplied) {
    db.settings({ ignoreUndefinedProperties: true });
    firestoreSettingsApplied = true;
  }
  return db;
}
