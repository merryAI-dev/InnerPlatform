import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getIdTokenClient = vi.fn();

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(() => ({ getIdTokenClient })),
}));

const { GoogleAuth } = await import('google-auth-library');
const { fetchGoogleIdentityToken, __clearIdentityTokenCachesForTest } = await import('./java-weekly-auth.mjs');

const serviceAccountJson = JSON.stringify({ client_email: 'bff@test.iam', private_key: 'k' });

// 진짜 JWT 모양 토큰. 캐시 만료는 exp 클레임에서 읽으므로 서명 없는 페이로드로 충분하다.
function jwtWithExpiry(label, expiresInMs) {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor((Date.now() + expiresInMs) / 1000),
    sub: label,
  })).toString('base64url');
  return `h.${payload}.s`;
}

function mockClientMinting(tokens) {
  const queue = [...tokens];
  const fetchIdToken = vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0]));
  getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
  return fetchIdToken;
}

describe('java weekly identity token cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearIdentityTokenCachesForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints once per token lifetime, not once per request', async () => {
    const token = jwtWithExpiry('long-lived', 60 * 60 * 1000);
    const fetchIdToken = mockClientMinting([token]);
    const audience = 'https://jvm-weekly.example/reuse';

    const first = await fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);
    const second = await fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);
    const third = await fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);

    expect(first).toBe(token);
    expect(second).toBe(token);
    expect(third).toBe(token);
    // month-close 한 번에 JVM 호출이 여러 번이다. 발급(RS256 서명 + oauth 교환)이
    // 호출마다 일어나면 그 수백 ms 가 사용자에게 "서버가 느립니다" 로 보인다.
    expect(GoogleAuth).toHaveBeenCalledTimes(1);
    expect(fetchIdToken).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight mint across concurrent requests (single-flight)', async () => {
    const token = jwtWithExpiry('shared', 60 * 60 * 1000);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchIdToken = vi.fn(async () => { await gate; return token; });
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
    const audience = 'https://jvm-weekly.example/single-flight';

    const inFlight = Promise.all([
      fetchGoogleIdentityToken(fetch, audience, serviceAccountJson),
      fetchGoogleIdentityToken(fetch, audience, serviceAccountJson),
      fetchGoogleIdentityToken(fetch, audience, serviceAccountJson),
    ]);
    release();
    await expect(inFlight).resolves.toEqual([token, token, token]);
    expect(fetchIdToken).toHaveBeenCalledTimes(1);
  });

  it('re-mints when the cached token is inside the refresh margin', async () => {
    // 5분 마진 안쪽이면 아직 유효해도 새로 발급한다. 만료 직전 토큰을 들고 나가
    // JVM 에서 401 을 맞는 것보다 한 번 더 서명하는 쪽이 싸다.
    const nearExpiry = jwtWithExpiry('near-expiry', 4 * 60 * 1000);
    const fresh = jwtWithExpiry('fresh', 60 * 60 * 1000);
    const fetchIdToken = mockClientMinting([nearExpiry, fresh]);
    const audience = 'https://jvm-weekly.example/refresh-margin';

    // 발급 결과 자체가 마진 안쪽이면 캐시에 넣지 않고 실패로 처리한다.
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).rejects.toMatchObject({
      code: 'jvm_weekly_api_identity_token_unavailable',
    });
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(fresh);
    expect(fetchIdToken).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by audience', async () => {
    mockClientMinting([jwtWithExpiry('per-audience', 60 * 60 * 1000)]);
    await fetchGoogleIdentityToken(fetch, 'https://jvm-weekly.example/aud-a', serviceAccountJson);
    await fetchGoogleIdentityToken(fetch, 'https://jvm-weekly.example/aud-b', serviceAccountJson);
    expect(getIdTokenClient).toHaveBeenCalledTimes(2);
  });

  it('drops only the failed key so the next request can recover', async () => {
    const audience = 'https://jvm-weekly.example/recover';
    getIdTokenClient.mockRejectedValueOnce(new Error('signer down'));
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).rejects.toMatchObject({
      code: 'jvm_weekly_api_identity_token_unavailable',
    });

    const recovered = jwtWithExpiry('recovered', 60 * 60 * 1000);
    mockClientMinting([recovered]);
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(recovered);
  });

  it('fails fast when minting hangs instead of eating the route budget', async () => {
    vi.useFakeTimers();
    const fetchIdToken = vi.fn(() => new Promise(() => {}));
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
    const audience = 'https://jvm-weekly.example/mint-timeout';

    const pending = fetchGoogleIdentityToken(fetch, audience, serviceAccountJson);
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'jvm_weekly_api_identity_token_unavailable',
    });
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
  });
});
