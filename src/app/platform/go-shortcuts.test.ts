import { describe, expect, it } from 'vitest';
import { resolveGoShortcutTarget } from './go-shortcuts';

describe('go shortcuts', () => {
  it('maps supported tokens to routes', () => {
    expect(resolveGoShortcutTarget('d')).toBe('/');
    expect(resolveGoShortcutTarget('p')).toBe('/projects');
    expect(resolveGoShortcutTarget('c')).toBe('/cashflow');
    expect(resolveGoShortcutTarget('e')).toBe('/evidence');
    expect(resolveGoShortcutTarget('a')).toBe('/audit');
    expect(resolveGoShortcutTarget('s')).toBe('/settings');
  });

  it('normalizes casing and spaces', () => {
    expect(resolveGoShortcutTarget(' D ')).toBe('/');
    expect(resolveGoShortcutTarget('P')).toBe('/projects');
  });

  it('returns null for unsupported tokens', () => {
    expect(resolveGoShortcutTarget('x')).toBeNull();
    expect(resolveGoShortcutTarget('')).toBeNull();
    expect(resolveGoShortcutTarget('  ')).toBeNull();
  });
});
