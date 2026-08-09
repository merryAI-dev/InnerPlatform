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
//   - 발급에는 자체 데드라인(8s)을 건다. 토큰 발급이 라우트 예산 전체를 먹으면
//     사용자는 원인 코드 대신 504 만 본다.
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
  const expiryMs = decodeJwtExpiryMs(token);
  if (expiryMs <= Date.now() + IDENTITY_TOKEN_REFRESH_MARGIN_MS) {
    throw new Error('Identity token expiry is invalid or too near');
  }
  return { token, expiryMs };
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
    let mintPromise = cached?.mintPromise;
    if (!mintPromise) {
      let timeoutId;
      mintPromise = Promise.race([
        mintIdentityToken(cacheKey, audience, credentials),
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('Identity token mint timed out')),
            IDENTITY_TOKEN_MINT_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timeoutId));
      identityTokenCache.set(cacheKey, { ...(cached || {}), mintPromise });
    }
    const minted = await mintPromise;
    identityTokenCache.set(cacheKey, { token: minted.token, expiryMs: minted.expiryMs });
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
