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
import { getAllowedEmailDomains } from '../platform/email-allowlist';

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
  firestoreEnabled: boolean;
  authEnabled: boolean;
  storageEnabled: boolean;
  firestorePort: number;
  authPort: number;
  storagePort: number;
}

interface LocationLike {
  hostname?: string;
  host?: string;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPort(value: unknown, fallback: number): number {
  const n = Number.parseInt(normalizeString(value), 10);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

function getRuntimeLocation(): LocationLike | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.location;
}

function normalizeHost(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  return withoutProtocol.replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}

function parseHostList(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeHost(entry))
    .filter(Boolean);
}

function isLoopbackDevHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '0.0.0.0'
    || normalized === '[::1]'
    || normalized.endsWith('.localhost');
}

function getLocationHostname(locationLike?: LocationLike): string {
  return normalizeHost(locationLike?.hostname || locationLike?.host);
}

export function shouldEnableFirebaseEmulatorsForLocation(locationLike?: LocationLike): boolean {
  const hostname = getLocationHostname(locationLike);
  if (!hostname) return true;
  return isLoopbackDevHostname(hostname);
}

function getFirebaseAuthProxyHosts(env: Record<string, unknown>): string[] {
  return parseHostList(env.VITE_FIREBASE_AUTH_PROXY_HOSTS);
}

export function resolveFirebaseAuthDomain(
  configuredAuthDomain: unknown,
  env: Record<string, unknown> = import.meta.env,
  locationLike: LocationLike | undefined = getRuntimeLocation(),
): string {
  const configured = normalizeString(configuredAuthDomain);
  const currentHost = getLocationHostname(locationLike);
  const proxyEnabled = parseFeatureFlag(env.VITE_FIREBASE_AUTH_PROXY_HELPER_ON_ALLOWED_HOSTS, false);
  if (!proxyEnabled || !currentHost || isLoopbackDevHostname(currentHost)) return configured;
  if (!getFirebaseAuthProxyHosts(env).includes(currentHost)) return configured;
  return currentHost;
}

export function readFirebaseConfigFromEnv(
  env: Record<string, unknown> = import.meta.env,
  locationLike: LocationLike | undefined = getRuntimeLocation(),
): FirebaseConfig | null {
  const cfg: FirebaseConfig = {
    apiKey: normalizeString(env.VITE_FIREBASE_API_KEY),
    authDomain: resolveFirebaseAuthDomain(env.VITE_FIREBASE_AUTH_DOMAIN, env, locationLike),
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
  locationLike: LocationLike | undefined = getRuntimeLocation(),
): FirebaseEmulatorConfig {
  const runtimeAllowsEmulators = shouldEnableFirebaseEmulatorsForLocation(locationLike);
  const enabled = parseFeatureFlag(env.VITE_FIREBASE_USE_EMULATORS, false);
  const firestoreEnabled = parseFeatureFlag(env.VITE_FIREBASE_USE_FIRESTORE_EMULATOR, enabled);
  const authEnabled = parseFeatureFlag(env.VITE_FIREBASE_USE_AUTH_EMULATOR, enabled);
  const storageEnabled = parseFeatureFlag(env.VITE_FIREBASE_USE_STORAGE_EMULATOR, enabled);
  const effectiveFirestoreEnabled = runtimeAllowsEmulators && firestoreEnabled;
  const effectiveAuthEnabled = runtimeAllowsEmulators && authEnabled;
  const effectiveStorageEnabled = runtimeAllowsEmulators && storageEnabled;
  return {
    enabled: effectiveFirestoreEnabled || effectiveAuthEnabled || effectiveStorageEnabled,
    host: normalizeString(env.VITE_FIREBASE_EMULATOR_HOST) || '127.0.0.1',
    firestoreEnabled: effectiveFirestoreEnabled,
    authEnabled: effectiveAuthEnabled,
    storageEnabled: effectiveStorageEnabled,
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

  if (emulator.firestoreEnabled) {
    connectFirestoreEmulator(db, emulator.host, emulator.firestorePort);
  }
  if (emulator.authEnabled) {
    connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, { disableWarnings: true });
  }
  if (emulator.storageEnabled) {
    connectStorageEmulator(storage, emulator.host, emulator.storagePort);
  }
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
  _googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');
  _googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
  _googleProvider.addScope('https://www.googleapis.com/auth/drive');
  const domains = getAllowedEmailDomains(import.meta.env);
  const hd = domains.length === 1 ? domains[0] : '';
  _googleProvider.setCustomParameters({
    prompt: 'select_account',
    ...(hd ? { hd } : {}),
  });
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
  // App-facing alias is camelCase, Firestore wire collection remains snake_case.
  cashflowWeeks: 'cashflow_weeks',
  cashflowWeeklyUpdateCompletions: 'cashflow_weekly_update_completions',
  cashflowEvents: 'cashflow_events',
  cashflowChangeCandidates: 'cashflow_change_candidates',
  cashflowEditLocks: 'cashflow_edit_locks',
  cashflowPresence: 'cashflow_presence',
  payrollSchedules: 'payroll_schedules',
  payrollRuns: 'payroll_runs',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
  ledgerTemplates: 'ledger_templates',
  hrAnnouncements: 'hr_announcements',
  projectChangeAlerts: 'project_change_alerts',
  expenseSets: 'expense_sets',
  changeRequests: 'change_requests',
  budgetEvidenceMaps: 'budget_evidence_maps',
  guideDocuments: 'guide_documents',
  guideQa: 'guide_qa',
  weeklySubmissionStatus: 'weekly_submission_status',
  projectRequests: 'project_requests',
  projectRequestDrafts: 'projectRequestDrafts',
  projectDashboardProjects: 'project_dashboard_projects',
  projectMigrationCandidates: 'project_migration_candidates',
  trainingCourses: 'trainingCourses',
  trainingEnrollments: 'trainingEnrollments',
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
