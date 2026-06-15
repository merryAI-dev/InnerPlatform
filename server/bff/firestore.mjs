import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
let firestoreSettingsApplied = false;

export function resolveProjectId(env = process.env) {
  return env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || 'demo-mysc';
}

export function isFirestoreEmulatorEnabled(env = process.env) {
  return !!env.FIRESTORE_EMULATOR_HOST;
}

function normalizeServiceAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = { ...raw };
  if (typeof normalized.private_key === 'string') {
    normalized.private_key = normalized.private_key.replace(/\\n/g, '\n');
  }
  return normalized;
}

function parseJsonValue(value, sourceName) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid ${sourceName}: expected valid JSON`);
  }
}

export function resolveServiceAccount(env = process.env) {
  const rawJson = typeof env.FIREBASE_SERVICE_ACCOUNT_JSON === 'string'
    ? env.FIREBASE_SERVICE_ACCOUNT_JSON.trim()
    : '';
  if (rawJson) {
    return normalizeServiceAccount(parseJsonValue(rawJson, 'FIREBASE_SERVICE_ACCOUNT_JSON'));
  }

  const rawBase64 = typeof env.FIREBASE_SERVICE_ACCOUNT_BASE64 === 'string'
    ? env.FIREBASE_SERVICE_ACCOUNT_BASE64.trim()
    : '';
  if (!rawBase64) return null;

  let decoded;
  try {
    decoded = Buffer.from(rawBase64, 'base64').toString('utf8');
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: expected base64 string');
  }

  return normalizeServiceAccount(parseJsonValue(decoded, 'FIREBASE_SERVICE_ACCOUNT_BASE64'));
}

export function getOrInitAdminApp({ projectId, appName } = {}) {
  if (appName) {
    try {
      return getApp(appName);
    } catch {
      // Initialize below.
    }
  } else if (getApps().length > 0) {
    return getApps()[0];
  }

  const resolvedProjectId = projectId || resolveProjectId();
  const useEmulator = isFirestoreEmulatorEnabled();
  const serviceAccount = resolveServiceAccount();
  const initialize = (options) => (appName ? initializeApp(options, appName) : initializeApp(options));

  if (useEmulator) {
    return initialize({ projectId: resolvedProjectId });
  }

  if (serviceAccount) {
    return initialize({
      projectId: resolvedProjectId,
      credential: cert(serviceAccount),
    });
  }

  try {
    return initialize({
      projectId: resolvedProjectId,
      credential: applicationDefault(),
    });
  } catch {
    return initialize({ projectId: resolvedProjectId });
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
