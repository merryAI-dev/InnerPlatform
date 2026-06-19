import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getDefaultOrgId,
  getOrgCollectionPath,
  getOrgDocumentPath,
  readFirebaseEmulatorConfig,
  readFirebaseConfigFromEnv,
  resolveFirebaseAuthDomain,
  selectFirebaseConfig,
  shouldEnableFirebaseEmulatorsForLocation,
  type FirebaseConfig,
} from './firebase';

const savedConfig: FirebaseConfig = {
  apiKey: 'saved-api-key',
  authDomain: 'saved-auth-domain',
  projectId: 'saved-project',
  storageBucket: 'saved-bucket',
  messagingSenderId: 'saved-msg',
  appId: 'saved-app',
};

describe('firebase org path builders', () => {
  it('builds org-scoped collection paths', () => {
    expect(getOrgCollectionPath('mysc', 'projects')).toBe('orgs/mysc/projects');
    expect(getOrgCollectionPath('org001', 'transactions')).toBe('orgs/org001/transactions');
    expect(getOrgCollectionPath('mysc', 'payrollSchedules')).toBe('orgs/mysc/payroll_schedules');
    expect(getOrgCollectionPath('mysc', 'payrollRuns')).toBe('orgs/mysc/payroll_runs');
    expect(getOrgCollectionPath('mysc', 'careerProfiles')).toBe('orgs/mysc/careerProfiles');
    expect(getOrgCollectionPath('mysc', 'trainingCourses')).toBe('orgs/mysc/trainingCourses');
    expect(getOrgCollectionPath('mysc', 'trainingEnrollments')).toBe('orgs/mysc/trainingEnrollments');
  });

  it('builds org-scoped document paths', () => {
    expect(getOrgDocumentPath('mysc', 'projects', 'p001')).toBe('orgs/mysc/projects/p001');
    expect(getOrgDocumentPath('mysc', 'payrollSchedules', 'p002')).toBe('orgs/mysc/payroll_schedules/p002');
    expect(getOrgDocumentPath('mysc', 'payrollRuns', 'p002-2026-04')).toBe('orgs/mysc/payroll_runs/p002-2026-04');
  });
});

describe('selectFirebaseConfig', () => {
  it('prefers env config when enabled', () => {
    const selected = selectFirebaseConfig(
      savedConfig,
      {
        VITE_FIREBASE_API_KEY: 'env-api-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'env-auth-domain',
        VITE_FIREBASE_PROJECT_ID: 'env-project',
        VITE_FIREBASE_STORAGE_BUCKET: 'env-bucket',
        VITE_FIREBASE_MESSAGING_SENDER_ID: 'env-msg',
        VITE_FIREBASE_APP_ID: 'env-app',
      },
      true,
    );

    expect(selected?.projectId).toBe('env-project');
  });

  it('falls back to saved config when env config is disabled', () => {
    const selected = selectFirebaseConfig(savedConfig, {}, false);
    expect(selected?.projectId).toBe('saved-project');
  });
});

describe('Firebase auth domain proxy', () => {
  it('keeps the configured Firebase auth domain on local development hosts', () => {
    expect(resolveFirebaseAuthDomain(
      'mysc-bmp-14173451.firebaseapp.com',
      {
        VITE_FIREBASE_AUTH_PROXY_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      },
      { hostname: 'localhost' },
    )).toBe('mysc-bmp-14173451.firebaseapp.com');
  });

  it('keeps the configured Firebase auth domain on fixed auth hosts unless proxy is explicitly configured', () => {
    expect(resolveFirebaseAuthDomain(
      'mysc-bmp-14173451.firebaseapp.com',
      {
        VITE_FIREBASE_AUTH_ALLOWED_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      },
      { hostname: 'inner-platform-git-dev-merryai-devs-projects.vercel.app' },
    )).toBe('mysc-bmp-14173451.firebaseapp.com');
  });

  it('uses the current app host as authDomain only for explicit proxy hosts', () => {
    const env = {
      VITE_FIREBASE_AUTH_ALLOWED_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      VITE_FIREBASE_AUTH_PROXY_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      VITE_FIREBASE_AUTH_PROXY_HELPER_ON_ALLOWED_HOSTS: 'true',
    };

    expect(resolveFirebaseAuthDomain(
      'mysc-bmp-14173451.firebaseapp.com',
      env,
      { hostname: 'inner-platform-git-dev-merryai-devs-projects.vercel.app' },
    )).toBe('inner-platform-git-dev-merryai-devs-projects.vercel.app');

    expect(resolveFirebaseAuthDomain(
      'mysc-bmp-14173451.firebaseapp.com',
      env,
      { hostname: 'inner-platform-random123-merryai-devs-projects.vercel.app' },
    )).toBe('mysc-bmp-14173451.firebaseapp.com');
  });

  it('applies authDomain proxy selection when reading env config', () => {
    const selected = readFirebaseConfigFromEnv({
      VITE_FIREBASE_API_KEY: 'env-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'mysc-bmp-14173451.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'env-project',
      VITE_FIREBASE_STORAGE_BUCKET: 'env-bucket',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'env-msg',
      VITE_FIREBASE_APP_ID: 'env-app',
      VITE_FIREBASE_AUTH_ALLOWED_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      VITE_FIREBASE_AUTH_PROXY_HOSTS: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
      VITE_FIREBASE_AUTH_PROXY_HELPER_ON_ALLOWED_HOSTS: 'true',
    }, {
      hostname: 'inner-platform-git-dev-merryai-devs-projects.vercel.app',
    });

    expect(selected?.authDomain).toBe('inner-platform-git-dev-merryai-devs-projects.vercel.app');
  });
});

describe('Google workspace auth provider', () => {
  it('forces consent when requesting Sheets access tokens', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'firebase.ts'), 'utf8');
    expect(source).toContain("addScope('https://www.googleapis.com/auth/spreadsheets')");
    expect(source).toContain("prompt: 'consent select_account'");
  });
});

describe('readFirebaseEmulatorConfig', () => {
  it('returns defaults when emulator flags are not set', () => {
    expect(readFirebaseEmulatorConfig({})).toEqual({
      enabled: false,
      host: '127.0.0.1',
      firestoreEnabled: false,
      authEnabled: false,
      storageEnabled: false,
      firestorePort: 8080,
      authPort: 9099,
      storagePort: 9199,
    });
  });

  it('reads emulator config from env values', () => {
    expect(readFirebaseEmulatorConfig({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_EMULATOR_HOST: 'localhost',
      VITE_FIRESTORE_EMULATOR_PORT: '8181',
      VITE_FIREBASE_AUTH_EMULATOR_PORT: '9292',
      VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9393',
    })).toEqual({
      enabled: true,
      host: 'localhost',
      firestoreEnabled: true,
      authEnabled: true,
      storageEnabled: true,
      firestorePort: 8181,
      authPort: 9292,
      storagePort: 9393,
    });
  });

  it('supports hybrid mode with real auth and emulator firestore/storage', () => {
    expect(readFirebaseEmulatorConfig({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_USE_FIRESTORE_EMULATOR: 'true',
      VITE_FIREBASE_USE_AUTH_EMULATOR: 'false',
      VITE_FIREBASE_USE_STORAGE_EMULATOR: 'true',
    })).toEqual({
      enabled: true,
      host: '127.0.0.1',
      firestoreEnabled: true,
      authEnabled: false,
      storageEnabled: true,
      firestorePort: 8080,
      authPort: 9099,
      storagePort: 9199,
    });
  });

  it('disables emulator usage on hosted origins even when env flags are enabled', () => {
    expect(readFirebaseEmulatorConfig({
      VITE_FIREBASE_USE_EMULATORS: 'true',
      VITE_FIREBASE_USE_FIRESTORE_EMULATOR: 'true',
      VITE_FIREBASE_USE_AUTH_EMULATOR: 'true',
      VITE_FIREBASE_USE_STORAGE_EMULATOR: 'true',
    }, {
      hostname: 'inner-platform.vercel.app',
    })).toEqual({
      enabled: false,
      host: '127.0.0.1',
      firestoreEnabled: false,
      authEnabled: false,
      storageEnabled: false,
      firestorePort: 8080,
      authPort: 9099,
      storagePort: 9199,
    });
  });
});

describe('shouldEnableFirebaseEmulatorsForLocation', () => {
  it('allows emulator usage on localhost-style origins', () => {
    expect(shouldEnableFirebaseEmulatorsForLocation({ hostname: 'localhost' })).toBe(true);
    expect(shouldEnableFirebaseEmulatorsForLocation({ hostname: '127.0.0.1' })).toBe(true);
    expect(shouldEnableFirebaseEmulatorsForLocation({ hostname: 'dev.localhost' })).toBe(true);
  });

  it('blocks emulator usage on hosted origins', () => {
    expect(shouldEnableFirebaseEmulatorsForLocation({ hostname: 'inner-platform.vercel.app' })).toBe(false);
    expect(shouldEnableFirebaseEmulatorsForLocation({ hostname: 'example.com' })).toBe(false);
  });
});

describe('getDefaultOrgId', () => {
  it('normalizes org id from env', () => {
    expect(getDefaultOrgId({ VITE_DEFAULT_ORG_ID: 'MYSC' })).toBe('mysc');
  });

  it('falls back when strict tenant mode is disabled', () => {
    expect(getDefaultOrgId({
      VITE_DEFAULT_ORG_ID: 'invalid org',
      VITE_TENANT_ISOLATION_STRICT: 'false',
    })).toBe('mysc');
  });
});
