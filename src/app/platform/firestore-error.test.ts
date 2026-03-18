import { describe, expect, it } from 'vitest';
import { isFirestoreError, isPermissionDenied } from './firestore-error';

describe('firestore-error', () => {
  it('detects Firestore error objects', () => {
    expect(isFirestoreError({ code: 'permission-denied', message: 'nope' })).toBe(true);
    expect(isFirestoreError({ code: 'not-found', message: '' })).toBe(true);
  });

  it('rejects non-Firestore errors', () => {
    expect(isFirestoreError(new Error('fail'))).toBe(false);
    expect(isFirestoreError(null)).toBe(false);
    expect(isFirestoreError('string')).toBe(false);
    expect(isFirestoreError({ message: 'no code' })).toBe(false);
  });

  it('detects permission-denied specifically', () => {
    expect(isPermissionDenied({ code: 'permission-denied', message: '' })).toBe(true);
    expect(isPermissionDenied({ code: 'not-found', message: '' })).toBe(false);
    expect(isPermissionDenied(new Error('fail'))).toBe(false);
  });
});
