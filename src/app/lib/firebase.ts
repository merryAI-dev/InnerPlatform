// ═══════════════════════════════════════════════════════════════
// MYSC 사업관리 통합 플랫폼 — Firebase 초기화
// Firestore + Auth + Storage
// ═══════════════════════════════════════════════════════════════

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { featureFlags, parseFeatureFlag } from '../config/feature-flags';
import { buildTenantScopedPath, resolveTenantId } from '../platform/tenant';

const STORAGE_KEY = 'MYSC_FIREBASE_CONFIG';

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export interface FirebaseEmulatorConfig {
  enabled: boolean;
  host: string;
  firestorePort: number;
  authPort: number;
  storagePort: number;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPort(value: unknown, fallback: number): number {
  const n = Number.parseInt(normalizeString(value), 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export function readFirebaseConfigFromEnv(
  env: Record<string, unknown> = import.meta.env,
): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: normalizeString(env.VITE_FIREBASE_API_KEY),
    authDomain: normalizeString(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: normalizeString(env.VITE_FIREBASE_PROJECT_ID),
    storageBucket: normalizeString(env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: normalizeString(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: normalizeString(env.VITE_FIREBASE_APP_ID),
  };

  return isConfigValid(cfg) ? cfg : null;
}

export function getSavedConfig(): FirebaseConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw) as FirebaseConfig;
    return isConfigValid(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg: FirebaseConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isConfigValid(cfg: FirebaseConfig | null): cfg is FirebaseConfig {
  return !!(
    cfg &&
    normalizeString(cfg.apiKey) &&
    normalizeString(cfg.projectId) &&
    normalizeString(cfg.authDomain)
  );
}

export function selectFirebaseConfig(
  savedConfig: FirebaseConfig | null,
  env: Record<string, unknown> = import.meta.env,
  preferEnv: boolean = featureFlags.firebaseUseEnvConfig,
): FirebaseConfig | null {
  const envConfig = readFirebaseConfigFromEnv(env);
  if (preferEnv && envConfig) return envConfig;
  if (savedConfig) return savedConfig;
  return envConfig;
}

export function getActiveFirebaseConfig(): FirebaseConfig | null {
  return selectFirebaseConfig(getSavedConfig(), import.meta.env, featureFlags.firebaseUseEnvConfig);
}

export function getDefaultOrgId(env: Record<string, unknown> = import.meta.env): string {
  return resolveTenantId({
    envTenantId: normalizeString(env.VITE_DEFAULT_ORG_ID),
    defaultTenantId: 'mysc',
    strict: parseFeatureFlag(env.VITE_TENANT_ISOLATION_STRICT, true),
  });
}

export function readFirebaseEmulatorConfig(
  env: Record<string, unknown> = import.meta.env,
): FirebaseEmulatorConfig {
  return {
    enabled: parseFeatureFlag(env.VITE_FIREBASE_USE_EMULATORS, false),
    host: normalizeString(env.VITE_FIREBASE_EMULATOR_HOST) || '127.0.0.1',
    firestorePort: readPort(env.VITE_FIRESTORE_EMULATOR_PORT, 8080),
    authPort: readPort(env.VITE_FIREBASE_AUTH_EMULATOR_PORT, 9099),
    storagePort: readPort(env.VITE_FIREBASE_STORAGE_EMULATOR_PORT, 9199),
  };
}

// ── Singleton instances ──

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;
let _googleProvider: GoogleAuthProvider | null = null;
let _emulatorsConnected = false;

function maybeConnectEmulators(db: Firestore, auth: Auth, storage: FirebaseStorage): void {
  if (_emulatorsConnected) return;
  const emulator = readFirebaseEmulatorConfig(import.meta.env);
  if (!emulator.enabled) return;

  connectFirestoreEmulator(db, emulator.host, emulator.firestorePort);
  connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, { disableWarnings: true });
  connectStorageEmulator(storage, emulator.host, emulator.storagePort);
  _emulatorsConnected = true;
}

export function initFirebase(config?: FirebaseConfig): {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
} | null {
  const cfg = config || getActiveFirebaseConfig();
  if (!isConfigValid(cfg)) return null;

  try {
    if (getApps().length === 0) {
      _app = initializeApp(cfg);
    } else {
      _app = getApps()[0];
    }

    _db = getFirestore(_app);
    _auth = getAuth(_app);
    _storage = getStorage(_app);
    maybeConnectEmulators(_db, _auth, _storage);
    return { app: _app, db: _db, auth: _auth, storage: _storage };
  } catch (err) {
    console.error('[MYSC Firebase] Init failed:', err);
    return null;
  }
}

export function getDb(): Firestore | null {
  if (_db) return _db;
  const result = initFirebase();
  return result?.db || null;
}

export function getAuthInstance(): Auth | null {
  if (_auth) return _auth;
  const result = initFirebase();
  return result?.auth || null;
}

export function getStorageInstance(): FirebaseStorage | null {
  if (_storage) return _storage;
  const result = initFirebase();
  return result?.storage || null;
}

export function getGoogleAuthProvider(): GoogleAuthProvider {
  if (_googleProvider) return _googleProvider;
  _googleProvider = new GoogleAuthProvider();
  _googleProvider.setCustomParameters({ prompt: 'select_account' });
  return _googleProvider;
}

// ── Firestore 컬렉션 경로 (org 스코프) ──

export const ORG_COLLECTIONS = {
  members: 'members',
  employees: 'employees',
  partProjects: 'part_projects',
  partEntries: 'part_entries',
  koicaProjects: 'koica_projects',
  koicaStaff: 'koica_staff',
  projects: 'projects',
  ledgers: 'ledgers',
  transactions: 'transactions',
  evidences: 'evidences',
  comments: 'comments',
  boardPosts: 'board_posts',
  boardComments: 'board_comments',
  boardVotes: 'board_votes',
  payrollSchedules: 'payroll_schedules',
  payrollRuns: 'payroll_runs',
  monthlyCloses: 'monthly_closes',
  auditLogs: 'audit_logs',
  ledgerTemplates: 'ledger_templates',
  hrAnnouncements: 'hr_announcements',
  projectChangeAlerts: 'project_change_alerts',
  expenseSets: 'expense_sets',
  changeRequests: 'change_requests',
} as const;

export type OrgCollectionKey = keyof typeof ORG_COLLECTIONS;

export function getOrgRootPath(orgId: string): string {
  return buildTenantScopedPath(orgId);
}

export function getOrgCollectionPath(orgId: string, key: OrgCollectionKey): string {
  return `${getOrgRootPath(orgId)}/${ORG_COLLECTIONS[key]}`;
}

export function getOrgDocumentPath(orgId: string, key: OrgCollectionKey, docId: string): string {
  return `${getOrgCollectionPath(orgId, key)}/${docId}`;
}
