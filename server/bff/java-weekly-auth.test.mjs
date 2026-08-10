import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getIdTokenClient = vi.fn();

vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn(() => ({ getIdTokenClient })),
}));

const { GoogleAuth } = await import('google-auth-library');
const {
  buildJavaWeeklyTrustedHeaders,
  fetchGoogleIdentityToken,
  __clearIdentityTokenCachesForTest,
} = await import('./java-weekly-auth.mjs');

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

  it('propagates the BFF request ID to the JVM without forwarding user credentials', async () => {
    await expect(buildJavaWeeklyTrustedHeaders({
      fetchImpl: fetch,
      context: {
        requestId: 'req_dashboard_trace', tenantId: 'tenant-1', actorId: 'actor-1', actorRole: 'admin',
      },
      serviceToken: 'internal-service-token',
    })).resolves.toMatchObject({
      'x-request-id': 'req_dashboard_trace',
      'x-tenant-id': 'tenant-1',
      'x-actor-id': 'actor-1',
      'x-actor-role': 'admin',
    });
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

  it('serves a near-margin token without caching it, then re-mints next time', async () => {
    // 5분 마진 안쪽 토큰은 캐시하지 않는다. 다만 요청 자체는 그 토큰으로 진행한다 -
    // 발급기가 준 토큰을 버리고 503 을 내는 것보다, 이번 요청을 살리고 다음 요청이
    // 새로 발급하는 쪽이 가용성에서 옳다.
    const nearExpiry = jwtWithExpiry('near-expiry', 4 * 60 * 1000);
    const fresh = jwtWithExpiry('fresh', 60 * 60 * 1000);
    const fetchIdToken = mockClientMinting([nearExpiry, fresh]);
    const audience = 'https://jvm-weekly.example/refresh-margin';

    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(nearExpiry);
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(fresh);
    // 첫 토큰이 캐시되지 않았으므로 두 번째 요청은 새로 발급한다.
    expect(fetchIdToken).toHaveBeenCalledTimes(2);
    // 새 토큰은 정상 캐시된다.
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
    // 발급은 호출당 두 번 시도한다. 확정 실패를 만들려면 두 번 다 죽여야 한다.
    getIdTokenClient
      .mockRejectedValueOnce(new Error('signer down'))
      .mockRejectedValueOnce(new Error('signer still down'));
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
    // 시도당 8s, 새 클라이언트로 한 번 더 - 최악 16s 에서 확정 실패한다.
    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
  });

  it('retries once with a fresh client before failing the waiters', async () => {
    // 한 번의 일시 장애(서명 클라이언트 오염 등)가 대기 중인 요청 전부를
    // 동시 503 으로 만들지 않게, 실패하면 새 클라이언트로 정확히 한 번 더 발급한다.
    const recovered = jwtWithExpiry('second-attempt', 60 * 60 * 1000);
    const fetchIdToken = vi.fn()
      .mockRejectedValueOnce(new Error('transient signer error'))
      .mockResolvedValue(recovered);
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
    const audience = 'https://jvm-weekly.example/retry-once';

    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(recovered);
    expect(fetchIdToken).toHaveBeenCalledTimes(2);
    // 재시도는 오염됐을 수 있는 클라이언트를 버리고 새로 만든다.
    expect(getIdTokenClient).toHaveBeenCalledTimes(2);
  });

  it('keeps serving when the minted expiry cannot be trusted, without caching it', async () => {
    // 시계 스큐나 exp 파싱 실패는 판정 불능이지 인증 실패가 아니다. 요청은 그 토큰으로
    // 진행하고 캐시만 하지 않는다 - 느려질 뿐 멈추지 않는다.
    const skewed = jwtWithExpiry('clock-skew', -60 * 1000);
    const fetchIdToken = vi.fn(async () => skewed);
    getIdTokenClient.mockResolvedValue({ idTokenProvider: { fetchIdToken } });
    const audience = 'https://jvm-weekly.example/clock-skew';

    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(skewed);
    await expect(fetchGoogleIdentityToken(fetch, audience, serviceAccountJson)).resolves.toBe(skewed);
    // 캐시가 없으니 매번 발급한다. 전면 차단(영구 503)이 아니라는 것이 요점이다.
    expect(fetchIdToken).toHaveBeenCalledTimes(2);
  });
});
