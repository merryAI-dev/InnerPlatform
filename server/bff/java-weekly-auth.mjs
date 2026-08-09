import { GoogleAuth } from 'google-auth-library';
import { createHttpError, readOptionalText } from './bff-utils.mjs';

export function resolveJavaWeeklyApiServiceAccountJson(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceAccountJson)
    || readOptionalText(env.JVM_WEEKLY_API_SERVICE_ACCOUNT_JSON)
    || readOptionalText(env.WEEKLY_API_SERVICE_ACCOUNT_JSON);
}

export function isWorkspaceAuthMode(authMode) {
  const normalized = readOptionalText(authMode).toLowerCase();
  return normalized === 'internal_saas_workspace' || normalized === 'workspace';
}

export function isWorkspaceUser(context, workspaceEmailDomain = 'mysc.co.kr') {
  const email = readOptionalText(context?.actorEmail).toLowerCase();
  const domain = readOptionalText(workspaceEmailDomain).replace(/^@+/, '').toLowerCase();
  return Boolean(domain) && email.endsWith(`@${domain}`);
}

// ── JVM 호출용 ID 토큰 캐시 ────────────────────────────────────────────────
//
// 토큰 "문자열"을 우리가 직접 캐시한다. 만료는 발급받은 JWT 의 exp 클레임에서 읽는다.
// 이렇게 하면 두 가지에서 자유로워진다.
//
//   1) 라이브러리 내부 캐시/헤더 형태. getRequestHeaders() 는 v9 가 평범한 객체를,
//      v10 이 Headers 를 반환한다. 그 형태를 긁는 코드는 설치 트리가 바뀌는 순간
//      조용히 죽는다 - 실제로 전 요청 503 을 만들 뻔했다. 여기서는 클라이언트를
//      "새 토큰이 필요할 때"만 쓰고, 평소에는 우리가 검증해 둔 문자열을 돌려준다.
//   2) 발급 왕복. RS256 서명 + oauth2.googleapis.com 교환은 수백 ms 다. month-close
//      읽기 한 번에 JVM 호출이 여러 번이라, 이 비용이 매 호출마다 들면 사용자에게
//      "서버가 느립니다"로 보인다. 정상 상태에서 발급은 토큰 수명(1시간)당 한 번이다.
//
// 규칙:
//   - 같은 키의 동시 요청은 발급 하나를 공유한다 (single-flight).
//   - 만료 5분 전부터는 새로 발급한다. 경계에서 만료 직전 토큰을 들고 나가지 않게.
//   - 발급 시도당 데드라인 8s, 실패하면 새 클라이언트로 한 번 더 (최악 16s).
//     한 번의 일시 장애가 대기 중인 요청 전부를 동시 503 으로 만들지 않게 하고,
//     attempt 예산 24s 인 쓰기 경로가 8s 짜리 단일 시도에 조기 절단되지 않게 한다.
//     읽기 경로는 자체 attempt 타임아웃(12s)이 먼저 끊으므로 영향 없다.
//   - 발급된 토큰의 exp 가 이상해도(시계 스큐, 파싱 실패) 요청은 그 토큰으로 계속
//     진행한다. 캐시만 하지 않는다. 판정 불능이 가용성 손실이 되면 안 된다.
//   - 실패는 해당 키만 버린다. 전체를 비우면 한 요청의 일시 장애가 무관한 audience 의
//     정상 토큰까지 축출해 발급 폭주(thundering herd)를 만든다.
const IDENTITY_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const IDENTITY_TOKEN_MINT_TIMEOUT_MS = 8_000;
const identityTokenClients = new Map();
const identityTokenCache = new Map();

function decodeJwtExpiryMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number.isSafeInteger(payload?.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function mintIdentityToken(cacheKey, audience, credentials) {
  let clientPromise = identityTokenClients.get(cacheKey);
  if (!clientPromise) {
    clientPromise = new GoogleAuth({ credentials }).getIdTokenClient(audience);
    identityTokenClients.set(cacheKey, clientPromise);
  }
  const client = await clientPromise;
  // 토큰 문자열이 필요할 뿐이므로 공식 발급 API 를 쓴다. 헤더 형태에 의존하지 않는다.
  const token = readOptionalText(await client.idTokenProvider.fetchIdToken(audience));
  if (!token) throw new Error('Missing identity token');
  return { token, expiryMs: decodeJwtExpiryMs(token) };
}

function raceMintTimeout(mint) {
  let timeoutId;
  // 타임아웃이 이긴 뒤 배경에 남은 발급이 늦게 거부되어도 프로세스를 흔들지 않게.
  mint.catch(() => {});
  return Promise.race([
    mint,
    new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('Identity token mint timed out')),
        IDENTITY_TOKEN_MINT_TIMEOUT_MS,
      );
      timeoutId.unref?.();
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export function __clearIdentityTokenCachesForTest() {
  identityTokenClients.clear();
  identityTokenCache.clear();
}

async function fetchCredentialIdentityToken(audience, serviceAccountJson) {
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw createHttpError(503, '서버 인증 정보가 올바르지 않습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_identity_token_unavailable');
  }
  const cacheKey = `${credentials.client_email || ''}\n${audience}`;
  const cached = identityTokenCache.get(cacheKey);
  if (cached?.token && cached.expiryMs > Date.now() + IDENTITY_TOKEN_REFRESH_MARGIN_MS) {
    return cached.token;
  }
  try {
    // 발급 중이면 그 발급을 같이 기다린다. 동시 N 요청이 N 번 서명하지 않게.
    // 재시도까지 mintPromise 안에 접어 넣어, 대기자들이 두 시도를 함께 공유한다.
    let mintPromise = cached?.mintPromise;
    if (!mintPromise) {
      mintPromise = (async () => {
        try {
          return await raceMintTimeout(mintIdentityToken(cacheKey, audience, credentials));
        } catch {
          // 서명 클라이언트가 오염됐을 수 있다. 새 클라이언트로 정확히 한 번 더.
          identityTokenClients.delete(cacheKey);
          return raceMintTimeout(mintIdentityToken(cacheKey, audience, credentials));
        }
      })();
      identityTokenCache.set(cacheKey, { ...(cached || {}), mintPromise });
    }
    const minted = await mintPromise;
    if (minted.expiryMs > Date.now() + IDENTITY_TOKEN_REFRESH_MARGIN_MS) {
      identityTokenCache.set(cacheKey, { token: minted.token, expiryMs: minted.expiryMs });
    } else {
      // exp 를 신뢰할 수 없으면(시계 스큐, 파싱 실패) 캐시 없이 이 요청만 진행한다.
      // 느려질 뿐 멈추지 않는다 - 판정 불능을 전면 차단으로 바꾸지 않는다.
      identityTokenCache.delete(cacheKey);
    }
    return minted.token;
  } catch {
    identityTokenClients.delete(cacheKey);
    identityTokenCache.delete(cacheKey);
    throw createHttpError(503, '서버 인증에 실패했습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_identity_token_unavailable');
  }
}

export async function fetchGoogleIdentityToken(fetchImpl, audience, serviceAccountJson, resolveIdentityToken, signal) {
  if (!audience) return '';
  if (serviceAccountJson) {
    if (typeof resolveIdentityToken === 'function') {
      const token = await resolveIdentityToken({ audience, serviceAccountJson, signal });
      if (!readOptionalText(token)) {
        throw createHttpError(503, '서버 인증에 실패했습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_identity_token_unavailable');
      }
      return String(token).trim();
    }
    return fetchCredentialIdentityToken(audience, serviceAccountJson);
  }
  const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
  const response = await fetchImpl(tokenUrl, {
    method: 'GET',
    headers: { 'Metadata-Flavor': 'Google' },
    ...(signal ? { signal } : {}),
  });
  const token = await response.text();
  if (!response.ok || !readOptionalText(token)) {
    throw createHttpError(503, '서버 인증에 실패했습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_identity_token_unavailable');
  }
  return token.trim();
}

export async function buildJavaWeeklyTrustedHeaders({
  fetchImpl,
  context,
  serviceToken,
  idTokenAudience,
  serviceAccountJson,
  resolveIdentityToken,
  authMode,
  workspaceEmailDomain,
  editSession,
  dataProjectId,
  signal,
}) {
  if (!serviceToken) {
    throw createHttpError(503, '서버 연결 정보가 설정되지 않았습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_token_unconfigured');
  }
  const actorRole = isWorkspaceAuthMode(authMode) && isWorkspaceUser(context, workspaceEmailDomain)
    ? 'workspace_user'
    : context.actorRole || '';
  const headers = {
    'content-type': 'application/json',
    'x-inner-platform-service-token': serviceToken,
    'x-tenant-id': context.tenantId,
    'x-actor-id': context.actorId,
    'x-actor-role': actorRole,
  };
  if (context.actorEmail) headers['x-actor-email'] = context.actorEmail;
  if (context.actorName) headers['x-actor-name'] = encodeURIComponent(context.actorName);
  if (dataProjectId) headers['x-data-project-id'] = dataProjectId;
  if (editSession) {
    headers['x-edit-session-id'] = readOptionalText(editSession.sessionId);
    headers['x-edit-lease-id'] = readOptionalText(editSession.leaseId);
    headers['x-edit-fence'] = String(editSession.fence);
    if (editSession.finalize === true) headers['x-edit-finalize'] = 'true';
  }
  const identityToken = await fetchGoogleIdentityToken(
    fetchImpl,
    idTokenAudience,
    serviceAccountJson,
    resolveIdentityToken,
    signal,
  );
  if (identityToken) headers.authorization = `Bearer ${identityToken}`;
  return headers;
}
