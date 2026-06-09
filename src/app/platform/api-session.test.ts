import { describe, expect, it, vi } from 'vitest';
import { clearPlatformApiSession, createPlatformApiSession } from './api-session';

describe('api-session', () => {
  it('does not create Java session cookies during Firebase login', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await createPlatformApiSession('firebase-id-token', { VITE_PLATFORM_API_ENABLED: 'true' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call Java logout for stateless Firebase Bearer auth', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await clearPlatformApiSession({ VITE_PLATFORM_API_ENABLED: 'true' });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not validate Vercel rewrite hosts for removed session sync', async () => {
    await expect(createPlatformApiSession('firebase-id-token', {
      PROD: 'true',
      VITE_PLATFORM_API_ENABLED: 'true',
      VITE_PLATFORM_API_BASE_URL: 'https://inner-platform-stage-merryai-devs-projects.vercel.app',
    })).resolves.toBeUndefined();
  });
});
