import { describe, expect, it } from 'vitest';
import { parseFeatureFlag, readFeatureFlags } from './feature-flags';

describe('parseFeatureFlag', () => {
  it('parses truthy flag values', () => {
    expect(parseFeatureFlag('true', false)).toBe(true);
    expect(parseFeatureFlag('YES', false)).toBe(true);
    expect(parseFeatureFlag('1', false)).toBe(true);
  });

  it('parses falsy flag values', () => {
    expect(parseFeatureFlag('false', true)).toBe(false);
    expect(parseFeatureFlag('OFF', true)).toBe(false);
    expect(parseFeatureFlag('0', true)).toBe(false);
  });

  it('falls back to defaults for unknown values', () => {
    expect(parseFeatureFlag('  maybe  ', true)).toBe(true);
    expect(parseFeatureFlag(undefined, false)).toBe(false);
  });
});

describe('readFeatureFlags', () => {
  it('reads all known flags with defaults', () => {
    const flags = readFeatureFlags({
      VITE_FIREBASE_AUTH_ENABLED: 'true',
      VITE_FIRESTORE_CORE_ENABLED: 'false',
      VITE_FIREBASE_USE_EMULATORS: '1',
      VITE_TENANT_ISOLATION_STRICT: '0',
      VITE_PLATFORM_API_ENABLED: 'yes',
    });

    expect(flags).toEqual({
      firebaseAuthEnabled: true,
      firestoreCoreEnabled: false,
      firebaseUseEnvConfig: true,
      firebaseUseEmulators: true,
      tenantIsolationStrict: false,
      platformApiEnabled: true,
      demoLoginEnabled: false,
    });
  });

  it('defaults firebase emulator flag to false', () => {
    const flags = readFeatureFlags({});
    expect(flags.firebaseUseEmulators).toBe(false);
    expect(flags.tenantIsolationStrict).toBe(true);
    expect(flags.platformApiEnabled).toBe(false);
    expect(flags.demoLoginEnabled).toBe(false);
  });
});
