import { describe, expect, it } from 'vitest';
import {
  getDefaultOrgId,
  getOrgCollectionPath,
  getOrgDocumentPath,
  readFirebaseEmulatorConfig,
  selectFirebaseConfig,
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
    expect(getOrgCollectionPath('mysc', 'careerProfiles')).toBe('orgs/mysc/careerProfiles');
    expect(getOrgCollectionPath('mysc', 'trainingCourses')).toBe('orgs/mysc/trainingCourses');
    expect(getOrgCollectionPath('mysc', 'trainingEnrollments')).toBe('orgs/mysc/trainingEnrollments');
  });

  it('builds org-scoped document paths', () => {
    expect(getOrgDocumentPath('mysc', 'projects', 'p001')).toBe('orgs/mysc/projects/p001');
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

describe('readFirebaseEmulatorConfig', () => {
  it('returns defaults when emulator flags are not set', () => {
    expect(readFirebaseEmulatorConfig({})).toEqual({
      enabled: false,
      host: '127.0.0.1',
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
      firestorePort: 8181,
      authPort: 9292,
      storagePort: 9393,
    });
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
