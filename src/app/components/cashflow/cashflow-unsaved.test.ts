import { describe, expect, it } from 'vitest';
import { hasUnsavedChanges } from './cashflow-unsaved';

describe('hasUnsavedChanges', () => {
  it('returns false when there are no states', () => {
    expect(hasUnsavedChanges({})).toBe(false);
  });

  it('returns false when all states are saved/unknown', () => {
    expect(hasUnsavedChanges({ a: 'saved', b: undefined, c: 'noop' })).toBe(false);
  });

  it('returns true when any state is dirty', () => {
    expect(hasUnsavedChanges({ a: 'saved', b: 'dirty' })).toBe(true);
  });

  it('returns true when any state is saving', () => {
    expect(hasUnsavedChanges({ a: 'saving' })).toBe(true);
  });

  it('returns true when any state is error', () => {
    expect(hasUnsavedChanges({ a: 'error' })).toBe(true);
  });
});

