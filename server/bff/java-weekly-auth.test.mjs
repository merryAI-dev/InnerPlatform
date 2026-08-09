import { beforeEach, describe, expect, it, vi } from 'vitest';

const getIdTokenClient = vi.fn();

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(() => ({ getIdTokenClient })),
}));

const { GoogleAuth } = await import('google-auth-library');
const { fetchGoogleIdentityToken } = await import('./java-weekly-auth.mjs');

const serviceAccountJson = JSON.stringify({ client_email: 'bff@test.iam', private_key: 'k' });

// 캐시는 모듈 수명이므로 테스트마다 고유한 audience 를 써서 서로 간섭하지 않게 한다.
describe('java weekly identity token cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses one IdTokenClient per audience instead of signing on every request', async () => {
    const getRequestHeaders = vi.fn(async () => ({ Authorization: 'Bearer cached-token' }));
    getIdTokenClient.mockResolvedValue({ getRequestHeaders });
    const audience = 'https://jvm-weekly.example/reuse';

    const first = await fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);
    const second = await fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);

    expect(first).toBe('cached-token');
    expect(second).toBe('cached-token');
    // month-close 한 번에 JVM 호출이 두 번이라, 클라이언트를 캐시하지 않으면
    // 요청마다 GoogleAuth 생성과 서명 왕복이 두 배로 든다.
    expect(GoogleAuth).toHaveBeenCalledTimes(1);
    expect(getIdTokenClient).toHaveBeenCalledTimes(1);
    // 만료 갱신은 클라이언트에 위임한다 — 캐시된 클라이언트라도 호출마다
    // getRequestHeaders 를 다시 물어 최신 토큰을 받는다.
    expect(getRequestHeaders).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by audience', async () => {
    getIdTokenClient.mockResolvedValue({
      getRequestHeaders: async () => ({ Authorization: 'Bearer t' }),
    });
    await fetchGoogleIdentityToken(fetch, 'https://jvm-weekly.example/aud-a', serviceAccountJson);
    await fetchGoogleIdentityToken(fetch, 'https://jvm-weekly.example/aud-b', serviceAccountJson);
    expect(getIdTokenClient).toHaveBeenCalledTimes(2);
  });

  it('drops the cache when token issuance fails so the next request can recover', async () => {
    const audience = 'https://jvm-weekly.example/recover';
    getIdTokenClient.mockRejectedValueOnce(new Error('signer down'));
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).rejects.toMatchObject({
      code: 'jvm_weekly_api_identity_token_unavailable',
    });

    getIdTokenClient.mockResolvedValue({
      getRequestHeaders: async () => ({ Authorization: 'Bearer recovered' }),
    });
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe('recovered');
  });
});
