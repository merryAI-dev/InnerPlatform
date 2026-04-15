import { describe, expect, it } from 'vitest';
import { canUseRealtimeListeners, normalizeRealtimeRole, shouldUseSafeFetchMode } from './firestore-realtime-mode';

describe('firestore realtime mode', () => {
  it('allows live listeners only for privileged roles', () => {
    expect(canUseRealtimeListeners('admin')).toBe(true);
    expect(canUseRealtimeListeners('tenant_admin')).toBe(true);
    expect(canUseRealtimeListeners('finance')).toBe(true);
    expect(canUseRealtimeListeners('auditor')).toBe(true);
    expect(canUseRealtimeListeners('pm')).toBe(false);
    expect(canUseRealtimeListeners('viewer')).toBe(false);
    expect(canUseRealtimeListeners('')).toBe(false);
  });

  it('normalizes role strings', () => {
    expect(normalizeRealtimeRole(' Finance ')).toBe('finance');
    expect(normalizeRealtimeRole(null)).toBe('');
  });

  it('routes PM roles to safe fetch mode', () => {
    expect(shouldUseSafeFetchMode('pm')).toBe(true);
    expect(shouldUseSafeFetchMode('viewer')).toBe(true);
    expect(shouldUseSafeFetchMode('admin')).toBe(false);
  });
});
