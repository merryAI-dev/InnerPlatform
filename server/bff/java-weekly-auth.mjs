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
  try {
    const cacheKey = `${credentials.client_email || ''}\n${audience}`;
    let clientPromise = identityTokenClients.get(cacheKey);
    if (!clientPromise) {
      clientPromise = new GoogleAuth({ credentials }).getIdTokenClient(audience);
      identityTokenClients.set(cacheKey, clientPromise);
    }
    const client = await clientPromise;
    const authorization = readOptionalText((await client.getRequestHeaders()).Authorization);
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Missing identity token');
    return token;
  } catch {
    identityTokenClients.clear();
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
