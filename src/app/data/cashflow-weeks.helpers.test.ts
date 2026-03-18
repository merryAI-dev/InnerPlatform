import { describe, expect, it } from 'vitest';
import { resolveFirestoreErrorCode, shouldCreateDocOnUpdateError } from './cashflow-weeks.helpers';

describe('cashflow weeks helpers', () => {
  it('resolves firestore error codes', () => {
    expect(resolveFirestoreErrorCode({ code: 'not-found' })).toBe('not-found');
    expect(resolveFirestoreErrorCode({ code: 123 })).toBe('');
    expect(resolveFirestoreErrorCode(null)).toBe('');
  });

  it('creates docs only when update failed due to missing document', () => {
    expect(shouldCreateDocOnUpdateError({ code: 'not-found' })).toBe(true);
    expect(shouldCreateDocOnUpdateError({ code: 'permission-denied' })).toBe(false);
    expect(shouldCreateDocOnUpdateError({})).toBe(false);
  });
});

