import { createHttpError, readOptionalText } from './bff-utils.mjs';
import {
  buildJavaWeeklyTrustedHeaders,
  resolveJavaWeeklyApiServiceAccountJson,
} from './java-weekly-auth.mjs';

export {
  buildJavaWeeklyTrustedHeaders,
  fetchGoogleIdentityToken,
  isWorkspaceAuthMode,
  isWorkspaceUser,
} from './java-weekly-auth.mjs';

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

const GENERIC_UPSTREAM_ERROR_CODES = new Set([
  'error',
  'internal_error',
  'internal_server_error',
  'unexpected_error',
]);

function readJavaError(status, payload) {
  const upstreamCode = readOptionalText(payload?.code);
  const hasStableCode = /^[a-z][a-z0-9_]{2,100}$/.test(upstreamCode)
    && !GENERIC_UPSTREAM_ERROR_CODES.has(upstreamCode);
  const upstreamFailure = status >= 500;
  const normalizedStatus = upstreamFailure ? 503 : status;
  const message = upstreamFailure
    ? '현금흐름 저장 서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
    : (readOptionalText(payload?.message) || readOptionalText(payload?.error) || `Java weekly API request failed with ${status}`);
  const code = hasStableCode
    ? upstreamCode
    : (upstreamFailure ? 'jvm_weekly_api_internal_error' : 'java_weekly_api_error');
  const error = createHttpError(normalizedStatus, message, code);
  error.upstreamStatus = status;
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
  jvmWeeklyApiServiceAccountJson,
  jvmWeeklyApiIdentityTokenResolver,
  jvmWeeklyAuthMode,
  jvmWeeklyWorkspaceEmailDomain,
  jvmWeeklyFirestoreProjectId,
  jvmWeeklyApiTimeoutMs,
} = {}) {
  const baseUrl = resolveJavaWeeklyApiBaseUrl({ jvmWeeklyApiBaseUrl }, env);
  const serviceToken = resolveJavaWeeklyApiServiceToken({ jvmWeeklyApiServiceToken }, env);
  const idTokenAudience = resolveJavaWeeklyApiIdTokenAudience({ jvmWeeklyApiIdTokenAudience }, env);
  const serviceAccountJson = resolveJavaWeeklyApiServiceAccountJson({ jvmWeeklyApiServiceAccountJson }, env);
  const authMode = resolveJavaWeeklyAuthMode({ jvmWeeklyAuthMode }, env);
  const workspaceEmailDomain = resolveJavaWeeklyWorkspaceEmailDomain({ jvmWeeklyWorkspaceEmailDomain }, env);
  const firestoreProjectId = resolveJavaWeeklyFirestoreProjectId({ jvmWeeklyFirestoreProjectId }, env);
  const bffDataProjectId = resolveBffDataProjectId({}, env);
  const configuredTimeoutMs = Number.parseInt(
    (Number.isFinite(jvmWeeklyApiTimeoutMs) ? String(jvmWeeklyApiTimeoutMs) : readOptionalText(jvmWeeklyApiTimeoutMs))
      || readOptionalText(env.JVM_WEEKLY_API_TIMEOUT_MS),
    10,
  );
  const requestTimeoutMs = Number.isSafeInteger(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.min(configuredTimeoutMs, 12_000)
    : 12_000;
  const totalRequestTimeoutMs = Math.min(requestTimeoutMs * 2, 24_000);

  async function requestJson({ context, method = 'GET', path, body, editSession, dataProjectId }) {
    if (!baseUrl) {
      throw createHttpError(503, 'JVM weekly API base URL is not configured.', 'jvm_weekly_api_unconfigured');
    }
    const requestStartedAt = Date.now();
    const send = async () => {
      const remainingMs = totalRequestTimeoutMs - (Date.now() - requestStartedAt);
      if (remainingMs <= 0) {
        const error = new Error('JVM weekly API total timeout exceeded');
        error.name = 'AbortError';
        throw error;
      }
      const controller = new AbortController();
      const attemptTimeoutMs = Math.min(requestTimeoutMs, remainingMs);
      let timeout;
      const timeoutPromise = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          const error = new Error('JVM weekly API attempt timeout exceeded');
          error.name = 'AbortError';
          reject(error);
        }, attemptTimeoutMs);
      });
      timeout.unref?.();
      const attemptPromise = (async () => {
        const headers = await buildJavaWeeklyTrustedHeaders({
          fetchImpl,
          context,
          serviceToken,
          idTokenAudience,
          serviceAccountJson,
          resolveIdentityToken: jvmWeeklyApiIdentityTokenResolver,
          authMode,
          workspaceEmailDomain,
          editSession,
          dataProjectId,
          signal: controller.signal,
        });
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
          method,
          headers,
          body: method === 'GET' ? undefined : JSON.stringify(body || {}),
          signal: controller.signal,
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw readJavaError(response.status, payload);
        return payload;
      })();
      try {
        return await Promise.race([attemptPromise, timeoutPromise]);
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      return await send();
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) throw error;
      try {
        return await send();
      } catch (retryError) {
        if (Number.isInteger(retryError?.statusCode)) throw retryError;
        throw createHttpError(
          503,
          '현금흐름 저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
          'jvm_weekly_api_unreachable',
        );
      }
    }
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
    sourceRevision,
    targetRevision,
    yearMonth,
    cells,
    replaceAllActualSources = false,
    closedMonthChangeReason = '',
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
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
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/apply`,
      dataProjectId: bffDataProjectId,
      body: {
        idempotencyKey,
        sourceRevision,
        targetRevision,
        yearMonth,
        cells,
        ...(replaceAllActualSources === true ? { replaceAllActualSources: true } : {}),
        ...(readOptionalText(closedMonthChangeReason) ? { closedMonthChangeReason: readOptionalText(closedMonthChangeReason) } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    return result;
  }

  async function applyCashflowSheetBatch({
    context,
    projectId,
    idempotencyKey,
    sourceRevision,
    targetRevision,
    months,
    replaceAllActualSources = false,
    closedMonthChangeReason = '',
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
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
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/batch/apply`,
      dataProjectId: bffDataProjectId,
      body: {
        idempotencyKey,
        sourceRevision,
        targetRevision,
        months,
        ...(replaceAllActualSources === true ? { replaceAllActualSources: true } : {}),
        ...(readOptionalText(closedMonthChangeReason) ? { closedMonthChangeReason: readOptionalText(closedMonthChangeReason) } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, 'JVM cashflow response project does not match the request.', 'jvm_weekly_project_mismatch');
    }
    return result;
  }

  async function applyCashflowSheetAnnualTotal({
    context,
    projectId,
    idempotencyKey,
    sourceRevision,
    year,
    expectedRevision,
    cells,
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) throw createHttpError(400, 'projectId is required.', 'project_id_required');
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
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/annual/apply`,
      dataProjectId: bffDataProjectId,
      body: { idempotencyKey, sourceRevision, year, expectedRevision, cells },
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
    applyCashflowSheetBatch,
    applyCashflowSheetAnnualTotal,
    authMode,
    workspaceEmailDomain,
    firestoreProjectId,
    bffDataProjectId,
  };
}
