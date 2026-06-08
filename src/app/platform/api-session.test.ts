import { describe, expect, it, vi } from 'vitest';
import { clearPlatformApiSession, createPlatformApiSession } from './api-session';

describe('api-session', () => {
  it('creates platform API session with credentials included', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await createPlatformApiSession('firebase-id-token', { VITE_PLATFORM_API_ENABLED: 'true' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/api/v1/auth/session');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({ idToken: 'firebase-id-token' });
  });

  it('clears platform API session with credentials included', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await clearPlatformApiSession({ VITE_PLATFORM_API_ENABLED: 'true' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8787/api/v1/auth/logout');
    expect(init?.credentials).toBe('include');
  });
});
