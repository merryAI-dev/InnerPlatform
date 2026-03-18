import { describe, expect, it } from 'vitest';
import {
  DEV_AUTH_HARNESS_STORAGE_KEY,
  clearDevHarnessSession,
  createDevHarnessSession,
  persistDevHarnessSession,
  readDevAuthHarnessConfig,
  readDevHarnessSession,
} from './dev-harness';

describe('dev-auth-harness', () => {
  it('enables only on localhost when env flag is on', () => {
    expect(readDevAuthHarnessConfig(
      { VITE_DEV_AUTH_HARNESS_ENABLED: 'true' },
      { hostname: 'localhost' },
    )).toEqual({ enabled: true, localhost: true });

    expect(readDevAuthHarnessConfig(
      { VITE_DEV_AUTH_HARNESS_ENABLED: 'true' },
      { hostname: 'inner-platform.vercel.app' },
    )).toEqual({ enabled: false, localhost: false });
  });

  it('creates pm and admin harness sessions', () => {
    const pm = createDevHarnessSession('pm', 'mysc');
    const admin = createDevHarnessSession('admin', 'mysc');

    expect(pm.source).toBe('dev_harness');
    expect(pm.role).toBe('pm');
    expect(pm.projectIds?.length).toBeGreaterThan(0);
    expect(admin.role).toBe('admin');
    expect(admin.projectId).toBeUndefined();
  });

  it('persists and clears harness session', () => {
    const storage = new Map<string, string>();
    const mockStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    };

    const session = createDevHarnessSession('pm', 'mysc');
    persistDevHarnessSession(session, mockStorage);
    expect(storage.has(DEV_AUTH_HARNESS_STORAGE_KEY)).toBe(true);
    expect(readDevHarnessSession(mockStorage)).toEqual(session);

    clearDevHarnessSession(mockStorage);
    expect(readDevHarnessSession(mockStorage)).toBeNull();
  });
});
