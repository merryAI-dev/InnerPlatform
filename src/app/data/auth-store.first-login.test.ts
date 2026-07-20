import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSafeFirstLoginMember } from './auth-store';

const authStoreSource = readFileSync(resolve(import.meta.dirname, 'auth-store.tsx'), 'utf8');

describe('first-login member bootstrap', () => {
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
