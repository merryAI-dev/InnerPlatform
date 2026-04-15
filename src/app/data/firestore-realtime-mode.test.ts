import { describe, expect, it } from 'vitest';
import { normalizeRealtimeRole, resolveFirestoreAccessPolicy } from './firestore-realtime-mode';

describe('firestore realtime mode', () => {
  it('allows realtime and read-all only for privileged roles on admin routes', () => {
    expect(resolveFirestoreAccessPolicy('admin-live', 'admin')).toMatchObject({
      allowRealtimeListeners: true,
      allowPrivilegedReadAll: true,
      useSafeFetchMode: false,
    });
    expect(resolveFirestoreAccessPolicy('admin-live', 'finance')).toMatchObject({
      allowRealtimeListeners: true,
      allowPrivilegedReadAll: true,
      useSafeFetchMode: false,
    });
    expect(resolveFirestoreAccessPolicy('admin-live', 'pm')).toMatchObject({
      allowRealtimeListeners: false,
      allowPrivilegedReadAll: false,
      useSafeFetchMode: true,
    });
  });

  it('normalizes role strings', () => {
    expect(normalizeRealtimeRole(' Finance ')).toBe('finance');
    expect(normalizeRealtimeRole(null)).toBe('');
  });

  it('forces safe fetch mode on portal routes even for privileged roles', () => {
    expect(resolveFirestoreAccessPolicy('portal-safe', 'admin')).toMatchObject({
      allowRealtimeListeners: false,
      allowPrivilegedReadAll: false,
      useSafeFetchMode: true,
    });
    expect(resolveFirestoreAccessPolicy('portal-safe', 'finance')).toMatchObject({
      allowRealtimeListeners: false,
      allowPrivilegedReadAll: false,
      useSafeFetchMode: true,
    });
    expect(resolveFirestoreAccessPolicy('safe', 'admin')).toMatchObject({
      allowRealtimeListeners: false,
      allowPrivilegedReadAll: false,
      useSafeFetchMode: true,
    });
  });
});
