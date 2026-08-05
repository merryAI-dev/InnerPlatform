import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSafeFirstLoginMember } from './auth-store';

const authStoreSource = readFileSync(resolve(import.meta.dirname, 'auth-store.tsx'), 'utf8');

describe('first-login member bootstrap', () => {
  it('lets the member ledger keep its display name when someone signs in again', () => {
    // Google account names arrive in whatever form each person set them, so a sign-in
    // must not overwrite the ledger's 이름(별명) value. A first login still falls back to
    // the account name because the ledger has nothing yet.
    expect(authStoreSource).toContain("name: existing?.name || firebaseUser.displayName || '사용자',");
    expect(authStoreSource).not.toContain("name: firebaseUser.displayName || existing?.name");
    expect(authStoreSource).toContain("name: firebaseUser.displayName || '사용자',");
  });

  it('creates only an unassigned PM profile that cannot self-elevate', () => {
    const member = buildSafeFirstLoginMember({
      uid: 'new-user',
      name: 'New User',
      email: 'new-user@mysc.co.kr',
      tenantId: 'mysc',
      avatarUrl: 'https://example.test/avatar.png',
      now: '2026-07-12T00:00:00.000Z',
    });

    expect(member).toEqual(expect.objectContaining({
      uid: 'new-user',
      role: 'pm',
      status: 'ACTIVE',
      tenantId: 'mysc',
      projectId: '',
      projectIds: [],
    }));
    expect(member).not.toHaveProperty('portalProfile');
    expect(member).not.toHaveProperty('projectNames');
    expect(member).not.toHaveProperty('department');
  });

  it('attaches a Firebase token before publishing the optimistic user', () => {
    const tokenRead = authStoreSource.indexOf('const optimisticIdToken = await firebaseUser.getIdToken()');
    const optimisticPublish = authStoreSource.indexOf('setUser(optimisticUser);', tokenRead);
    expect(tokenRead).toBeGreaterThan(-1);
    expect(optimisticPublish).toBeGreaterThan(tokenRead);
  });
});
