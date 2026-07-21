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

async function fetchCredentialIdentityToken(audience, serviceAccountJson) {
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    throw createHttpError(503, 'JVM weekly API invoker credential is invalid.', 'jvm_weekly_api_identity_token_unavailable');
  }
  try {
    const auth = new GoogleAuth({ credentials });
    const client = await auth.getIdTokenClient(audience);
    const authorization = readOptionalText((await client.getRequestHeaders()).Authorization);
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) throw new Error('Missing identity token');
    return token;
  } catch {
    throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
  }
}

export async function fetchGoogleIdentityToken(fetchImpl, audience, serviceAccountJson, resolveIdentityToken) {
  if (!audience) return '';
  if (serviceAccountJson) {
    if (typeof resolveIdentityToken === 'function') {
      const token = await resolveIdentityToken({ audience, serviceAccountJson });
      if (!readOptionalText(token)) {
        throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
      }
      return String(token).trim();
    }
    return fetchCredentialIdentityToken(audience, serviceAccountJson);
  }
  const tokenUrl = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
  const response = await fetchImpl(tokenUrl, {
    method: 'GET',
    headers: { 'Metadata-Flavor': 'Google' },
  });
  const token = await response.text();
  if (!response.ok || !readOptionalText(token)) {
    throw createHttpError(503, 'JVM weekly API identity token could not be resolved.', 'jvm_weekly_api_identity_token_unavailable');
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
}) {
  if (!serviceToken) {
    throw createHttpError(503, 'JVM weekly API service token is not configured.', 'jvm_weekly_api_token_unconfigured');
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
  );
  if (identityToken) headers.authorization = `Bearer ${identityToken}`;
  return headers;
}
