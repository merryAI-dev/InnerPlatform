import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const authStoreSource = readFileSync(resolve(import.meta.dirname, 'auth-store.tsx'), 'utf8');

describe('first-login member bootstrap', () => {
  it('lets the member ledger keep its display name when someone signs in again', () => {
    // Google account names arrive in whatever form each person set them, so a sign-in
    // must not overwrite the ledger's 이름(별명) value. A first login still falls back to
    // the account name because the ledger has nothing yet.
    // A sign-in writes no name at all; the field is only seeded when the ledger has none.
    expect(authStoreSource).toContain("...(existing?.name ? {} : { name: firebaseUser.displayName || '사용자' }),");
    expect(authStoreSource).not.toContain("name: existing?.name || firebaseUser.displayName");
    expect(authStoreSource).not.toContain("name: firebaseUser.displayName || existing?.name");
    expect(authStoreSource).not.toContain('buildSafeFirstLoginMember');
  });

  it('does not provision membership from the browser on first login', () => {
    expect(authStoreSource).toContain('if (!memberSnap.exists()) return undefined;');
    expect(authStoreSource).not.toContain('await setDoc(memberRef, created);');
  });

  it('does not turn a legacy status-less member into ACTIVE from the browser', () => {
    expect(authStoreSource).toContain("Object.prototype.hasOwnProperty.call(canonicalMember, 'status')");
    expect(authStoreSource).not.toContain("status: existing?.status || 'ACTIVE'");
  });

  it('attaches a Firebase token before publishing the optimistic user', () => {
    const tokenRead = authStoreSource.indexOf('const optimisticIdToken = await firebaseUser.getIdToken()');
    const optimisticPublish = authStoreSource.indexOf('setUser(optimisticUser);', tokenRead);
    expect(tokenRead).toBeGreaterThan(-1);
    expect(optimisticPublish).toBeGreaterThan(tokenRead);
  });
});
