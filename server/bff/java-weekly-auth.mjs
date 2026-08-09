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

// audience+자격증명별 IdTokenClient 캐시. 클라이언트는 토큰 만료를 스스로 관리하며
// 갱신하므로(google-auth-library), 요청마다 GoogleAuth 를 새로 만들어 RS256 서명
// 왕복을 반복할 이유가 없다. month-close 한 번에 JVM 호출이 두 번이라 이 비용이
// 요청마다 두 배로 들었다. 캐시 키에 자격증명을 포함해 SA 교체 시 자연히 분리된다.
const identityTokenClients = new Map();

async function fetchCredentialIdentityToken(audience, serviceAccountJson) {
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw createHttpError(503, '서버 인증 정보가 올바르지 않습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_identity_token_unavailable');
  }
  const cacheKey = `${credentials.client_email || ''}\n${audience}`;
  try {
    let clientPromise = identityTokenClients.get(cacheKey);
    if (!clientPromise) {
      clientPromise = new GoogleAuth({ credentials }).getIdTokenClient(audience);
      identityTokenClients.set(cacheKey, clientPromise);
    }
    const client = await clientPromise;
    // google-auth-library v9 는 getRequestHeaders() 가 평범한 객체를, v10 은 Headers 를
    // 반환한다. 이 패키지는 hoist 로 끌려오는 간접 의존성이라(직접 선언은 package.json 참고)
    // 설치 트리가 바뀌면 반환 타입도 조용히 바뀐다. 둘 다 읽는다 - v10 에서 .Authorization 만
    // 읽으면 undefined 가 되어 전 요청이 503 으로 죽는다.
    const rawHeaders = await client.getRequestHeaders();
    const authorization = readOptionalText(
      typeof rawHeaders?.get === 'function'
        ? rawHeaders.get('authorization')
        : (rawHeaders?.Authorization ?? rawHeaders?.authorization),
    );
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Missing identity token');
    return token;
  } catch {
    // 실패한 키만 버린다. Map 전체를 비우면 한 요청의 일시적 실패가 다른 audience 의
    // 정상 클라이언트까지 축출해 동시 요청 전부가 토큰을 다시 서명하게 된다.
    identityTokenClients.delete(cacheKey);
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
