import { createHttpError, readOptionalText } from './bff-utils.mjs';

export function resolveJavaWeeklyApiBaseUrl(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiBaseUrl)
    || readOptionalText(env.JVM_WEEKLY_API_BASE_URL)
    || readOptionalText(env.WEEKLY_API_BASE_URL);
}

export function resolveJavaWeeklyApiServiceToken(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiServiceToken)
    || readOptionalText(env.JVM_WEEKLY_INTERNAL_API_TOKEN)
    || readOptionalText(env.WEEKLY_API_INTERNAL_TOKEN);
}

export function resolveJavaWeeklyApiIdTokenAudience(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyApiIdTokenAudience)
    || readOptionalText(env.JVM_WEEKLY_API_ID_TOKEN_AUDIENCE)
    || readOptionalText(env.WEEKLY_API_ID_TOKEN_AUDIENCE);
}

export function resolveJavaWeeklyAuthMode(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyAuthMode)
    || readOptionalText(env.JVM_WEEKLY_AUTH_MODE)
    || readOptionalText(env.WEEKLY_AUTH_MODE)
    || 'strict';
}

export function resolveJavaWeeklyWorkspaceEmailDomain(options = {}, env = process.env) {
  const raw = readOptionalText(options.jvmWeeklyWorkspaceEmailDomain)
    || readOptionalText(env.JVM_WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || readOptionalText(env.WEEKLY_WORKSPACE_EMAIL_DOMAIN)
    || 'mysc.co.kr';
  return raw.replace(/^@+/, '').toLowerCase();
}

export function resolveJavaWeeklyFirestoreProjectId(options = {}, env = process.env) {
  return readOptionalText(options.jvmWeeklyFirestoreProjectId)
    || readOptionalText(env.JVM_WEEKLY_FIRESTORE_PROJECT_ID)
    || readOptionalText(env.WEEKLY_FIRESTORE_PROJECT_ID);
}

export function resolveBffDataProjectId(options = {}, env = process.env) {
  return readOptionalText(options.bffDataProjectId)
    || readOptionalText(env.FIREBASE_PROJECT_ID)
    || readOptionalText(env.VITE_FIREBASE_PROJECT_ID)
    || readOptionalText(env.GCLOUD_PROJECT)
    || readOptionalText(env.GOOGLE_CLOUD_PROJECT);
}

function parsePositiveSafeInteger(value) {
  const text = readOptionalText(String(value ?? ''));
  if (!/^[1-9]\d*$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
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

export async function fetchGoogleIdentityToken(fetchImpl, audience) {
  if (!audience) return '';
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
  if (context.actorEmail) {
    headers['x-actor-email'] = context.actorEmail;
  }
  if (context.actorName) {
    headers['x-actor-name'] = encodeURIComponent(context.actorName);
  }
  if (dataProjectId) headers['x-data-project-id'] = dataProjectId;
  if (editSession) {
    headers['x-edit-session-id'] = readOptionalText(editSession.sessionId);
    headers['x-edit-lease-id'] = readOptionalText(editSession.leaseId);
    headers['x-edit-fence'] = String(editSession.fence);
    if (editSession.finalize === true) headers['x-edit-finalize'] = 'true';
  }
  const identityToken = await fetchGoogleIdentityToken(fetchImpl, idTokenAudience);
  if (identityToken) {
    headers.authorization = `Bearer ${identityToken}`;
  }
  return headers;
}

function readJavaError(status, payload) {
  const message = readOptionalText(payload?.message) || readOptionalText(payload?.error) || `Java weekly API request failed with ${status}`;
  const code = readOptionalText(payload?.code) || readOptionalText(payload?.error) || 'java_weekly_api_error';
  const error = createHttpError(status, message, code);
  if (Number.isSafeInteger(payload?.expectedWriteCount)) {
    error.details = { expectedWriteCount: payload.expectedWriteCount };
  }
  return error;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createJavaWeeklyClient({
  env = process.env,
  fetchImpl = globalThis.fetch,
  jvmWeeklyApiBaseUrl,
  jvmWeeklyApiServiceToken,
  jvmWeeklyApiIdTokenAudience,
  jvmWeeklyAuthMode,
  jvmWeeklyWorkspaceEmailDomain,
  jvmWeeklyFirestoreProjectId,
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);
  const authMode = resolveJavaWeeklyAuthMode({ jvmWeeklyAuthMode }, env);
  const workspaceEmailDomain = resolveJavaWeeklyWorkspaceEmailDomain({ jvmWeeklyWorkspaceEmailDomain }, env);
  const firestoreProjectId = resolveJavaWeeklyFirestoreProjectId({ jvmWeeklyFirestoreProjectId }, env);
  const bffDataProjectId = resolveBffDataProjectId({}, env);

  async function requestJson({ context, method = 'GET', path, body, editSession, dataProjectId }) {
    if (!baseUrl) {
      throw createHttpError(503, 'JVM weekly API base URL is not configured.', 'jvm_weekly_api_unconfigured');
    }
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: await buildJavaWeeklyTrustedHeaders({
        fetchImpl,
        context,
        serviceToken,
        idTokenAudience,
        authMode,
        workspaceEmailDomain,
        editSession,
        dataProjectId,
      }),
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    });

    const payload = await readJsonResponse(response);
    if (!response.ok) throw readJavaError(response.status, payload);
    return payload;
  }

  async function getCashflowSnapshot({ context, projectId }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
    }
    return requestJson({
      context,
      method: 'GET',
      path: `/api/v1/cashflow/${normalizedProjectId}`,
    });
  }

  async function applyCashflowSheetLab({
    context,
    projectId,
    idempotencyKey,
    editSession,
    sourceRevision,
    targetRevision,
    yearMonth,
    cells,
    replaceAllActualSources = false,
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
    }
    if (readOptionalText(env.BFF_EDIT_LEASES_ENABLED).toLowerCase() !== 'true') {
      throw createHttpError(503, 'Cashflow writes require the Stage edit-lease runtime.', 'cashflow_edit_leases_disabled');
    }
    if (readOptionalText(env.BFF_DEPLOY_ENV).toLowerCase() !== 'stage') {
      throw createHttpError(503, 'Cashflow writes are restricted to Stage.', 'unsafe_bff_runtime');
    }
    if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
      throw createHttpError(503, 'BFF and JVM cashflow data projects do not match.', 'jvm_weekly_data_project_mismatch');
    }
    const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
    if (bffDataProjectId === liveProjectId) {
      throw createHttpError(503, 'Cashflow Stage writes cannot target the Live data project.', 'unsafe_bff_runtime');
    }
    const sessionId = readOptionalText(editSession?.sessionId);
    const leaseId = readOptionalText(editSession?.leaseId);
    const fence = parsePositiveSafeInteger(editSession?.fence);
    if (!sessionId || !leaseId || fence === null) {
      throw createHttpError(400, 'Cashflow edit lease headers are required.', 'cashflow_edit_lease_request_invalid');
    }
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/apply`,
      editSession: { sessionId, leaseId, fence, finalize: editSession?.finalize === true },
      dataProjectId: bffDataProjectId,
      body: {
        idempotencyKey,
        sourceRevision,
        targetRevision,
        yearMonth,
        cells,
        ...(replaceAllActualSources === true ? { replaceAllActualSources: true } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    return result;
  }

  return {
    requestJson,
    getCashflowSnapshot,
    applyCashflowSheetLab,
    authMode,
    workspaceEmailDomain,
    firestoreProjectId,
    bffDataProjectId,
  };
}
