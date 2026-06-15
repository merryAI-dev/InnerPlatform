import { describe, expect, it } from 'vitest';
import { resolveFirebaseAuthProjectId } from './auth.mjs';

describe('resolveFirebaseAuthProjectId', () => {
  it('allows BFF Firestore and Firebase Auth projects to be split', () => {
    expect(resolveFirebaseAuthProjectId({}, {
      FIREBASE_PROJECT_ID: 'inner-platform-qa-20260310',
      BFF_FIREBASE_AUTH_PROJECT_ID: 'mysc-bmp-14173451',
      VITE_FIREBASE_PROJECT_ID: 'browser-project',
    } as any, 'inner-platform-qa-20260310')).toBe('mysc-bmp-14173451');
  });

  it('falls back to the browser Firebase project before the BFF Firestore project', () => {
    expect(resolveFirebaseAuthProjectId({}, {
      FIREBASE_PROJECT_ID: 'inner-platform-qa-20260310',
      VITE_FIREBASE_PROJECT_ID: 'mysc-bmp-14173451',
    } as any, 'inner-platform-qa-20260310')).toBe('mysc-bmp-14173451');
  });

  it('falls back to the BFF Firestore project when no auth project is configured', () => {
    expect(resolveFirebaseAuthProjectId({}, {} as any, 'inner-platform-qa-20260310'))
      .toBe('inner-platform-qa-20260310');
  });
});
