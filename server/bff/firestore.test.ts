import { describe, expect, it } from 'vitest';
import { resolveProjectId, resolveServiceAccount } from './firestore.mjs';

describe('firestore config helpers', () => {
  it('resolves project id with explicit priority', () => {
    expect(resolveProjectId({
      FIREBASE_PROJECT_ID: 'p-1',
      VITE_FIREBASE_PROJECT_ID: 'p-2',
      GCLOUD_PROJECT: 'p-3',
    } as any)).toBe('p-1');

    expect(resolveProjectId({
      VITE_FIREBASE_PROJECT_ID: 'p-2',
      GCLOUD_PROJECT: 'p-3',
    } as any)).toBe('p-2');

    expect(resolveProjectId({
      GCLOUD_PROJECT: 'p-3',
    } as any)).toBe('p-3');
  });

  it('parses service account json and normalizes private key newlines', () => {
    const account = resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: 'demo-project',
        client_email: 'svc@demo.iam.gserviceaccount.com',
        private_key: 'line1\\nline2',
      }),
    } as any);

    expect(account).toBeTruthy();
    expect(account?.project_id).toBe('demo-project');
    expect(account?.private_key).toContain('\n');
  });

  it('parses base64 encoded service account json', () => {
    const json = JSON.stringify({
      project_id: 'demo-base64',
      client_email: 'svc@demo.iam.gserviceaccount.com',
      private_key: 'key',
    });
    const encoded = Buffer.from(json, 'utf8').toString('base64');

    const account = resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_BASE64: encoded,
    } as any);

    expect(account?.project_id).toBe('demo-base64');
  });

  it('returns null when no service account env is set', () => {
    expect(resolveServiceAccount({} as any)).toBeNull();
  });

  it('throws on invalid service account json', () => {
    expect(() => resolveServiceAccount({
      FIREBASE_SERVICE_ACCOUNT_JSON: '{invalid',
    } as any)).toThrow(/Invalid FIREBASE_SERVICE_ACCOUNT_JSON/);
  });
});
