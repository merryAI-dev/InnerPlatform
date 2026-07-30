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
  if (payload?.details && typeof payload.details === 'object' && !Array.isArray(payload.details)) {
    error.details = payload.details;
  } else if (Number.isSafeInteger(payload?.expectedWriteCount)) {
    error.details = { expectedWriteCount: payload.expectedWriteCount };
  }
  return error;
}

function responseTooLargeError() {
  return createHttpError(
    502,
    '현금흐름 저장 서버의 응답이 너무 커서 처리할 수 없습니다.',
    'jvm_weekly_response_too_large',
  );
}

async function readJsonResponse(response, maxResponseBytes) {
  const declaredLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
  if (Number.isSafeInteger(declaredLength) && declaredLength > maxResponseBytes) {
    throw responseTooLargeError();
  }
  if (!response.body) return { empty: true, malformed: false, payload: null };

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => {});
        throw responseTooLargeError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }

  if (totalBytes === 0) return { empty: true, malformed: false, payload: null };
  const text = Buffer.concat(chunks, totalBytes).toString('utf8');
  if (!text.trim()) return { empty: true, malformed: false, payload: null };
  try {
    return { empty: false, malformed: false, payload: JSON.parse(text) };
  } catch {
    return { empty: false, malformed: true, payload: null };
  }
}

function safeEndpoint(baseUrl) {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return 'configured-jvm-weekly-api';
  }
}

function attachTransportMetadata(error, metadata) {
  Object.assign(error, metadata);
  return error;
}

function markTransportFailure(error) {
  Object.defineProperty(error, 'transportFailure', { value: true });
  return error;
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
  jvmWeeklyApiMaxResponseBytes,
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
  const configuredMaxResponseBytes = Number.parseInt(
    (Number.isFinite(jvmWeeklyApiMaxResponseBytes) ? String(jvmWeeklyApiMaxResponseBytes) : readOptionalText(jvmWeeklyApiMaxResponseBytes))
      || readOptionalText(env.JVM_WEEKLY_API_MAX_RESPONSE_BYTES),
    10,
  );
  const maxResponseBytes = Number.isSafeInteger(configuredMaxResponseBytes) && configuredMaxResponseBytes > 0
    ? configuredMaxResponseBytes
    : 1_048_576;

  async function requestJson({
    context,
    method = 'GET',
    path,
    command,
    body,
    editSession,
    dataProjectId,
    deadlineAtMs,
    attemptTimeoutMs = requestTimeoutMs,
    retry,
    mutation = !['GET', 'HEAD'].includes(method),
  }) {
    const requestStartedAt = Date.now();
    const endpoint = safeEndpoint(baseUrl);
    const commandName = readOptionalText(command) || method.toLowerCase();
    const metadata = (attempt, upstreamStatus, retryable, mutationOutcome) => ({
      endpoint,
      command: commandName,
      attempt,
      elapsedMs: Math.max(0, Date.now() - requestStartedAt),
      upstreamStatus,
      retryable,
      mutationOutcome,
    });
    if (!baseUrl) {
      throw attachTransportMetadata(
        createHttpError(503, '캐시플로 서버 주소가 설정되지 않았습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_api_unconfigured'),
        metadata(0, undefined, false, mutation ? 'not_started' : 'failed'),
      );
    }
    const callerDeadlineAtMs = Number.isFinite(Number(deadlineAtMs))
      ? Number(deadlineAtMs)
      : Number.POSITIVE_INFINITY;
    const boundedAttemptTimeoutMs = Math.min(Math.max(1, attemptTimeoutMs), 24_000);
    const requestDeadlineAtMs = callerDeadlineAtMs;
    const callerDeadlineReached = () => Number.isFinite(callerDeadlineAtMs) && Date.now() >= callerDeadlineAtMs;
    const callerDeadlineError = (attempt, mutationOutcome) => attachTransportMetadata(
      createHttpError(
        504,
        '월 결산 서버 처리 시간이 초과되었습니다. 서버 결과를 다시 조회해 주세요.',
        'cashflow_month_close_route_timeout',
      ),
      metadata(attempt, undefined, true, mutationOutcome),
    );
    const send = async (attempt) => {
      const remainingMs = requestDeadlineAtMs - Date.now();
      if (remainingMs <= 0) {
        if (callerDeadlineReached()) throw callerDeadlineError(attempt, mutation ? 'not_started' : 'failed');
        const error = new Error('JVM weekly API total timeout exceeded');
        error.name = 'AbortError';
        throw error;
      }
      const controller = new AbortController();
      const timeoutMs = Math.min(boundedAttemptTimeoutMs, remainingMs);
      let sent = false;
      let upstreamStatus;
      let timeout;
      const timeoutPromise = new Promise((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          const error = new Error('JVM weekly API attempt timeout exceeded');
          error.name = 'AbortError';
          reject(error);
        }, timeoutMs);
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
        sent = true;
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
          method,
          headers,
          body: method === 'GET' ? undefined : JSON.stringify(body || {}),
          signal: controller.signal,
        });
        upstreamStatus = response.status;
        const parsed = await readJsonResponse(response, maxResponseBytes);
        if (!response.ok) {
          throw attachTransportMetadata(
            readJavaError(response.status, parsed.payload),
            metadata(attempt, response.status, response.status >= 500, mutation && response.status >= 500 ? 'uncertain' : 'failed'),
          );
        }
        if (parsed.empty || parsed.malformed) {
          throw attachTransportMetadata(
            createHttpError(502, '현금흐름 저장 서버의 응답을 확인할 수 없습니다.', 'jvm_weekly_response_invalid'),
            metadata(attempt, response.status, false, mutation ? 'uncertain' : 'failed'),
          );
        }
        return parsed.payload;
      })();
      try {
        return await Promise.race([attemptPromise, timeoutPromise]);
      } catch (error) {
        if (Number.isInteger(error?.statusCode)) {
          if (!Number.isInteger(error.attempt)) {
            attachTransportMetadata(
              error,
              metadata(attempt, upstreamStatus, false, mutation && sent ? 'uncertain' : (mutation ? 'not_started' : 'failed')),
            );
          }
          throw error;
        }
        throw markTransportFailure(attachTransportMetadata(
          createHttpError(
            503,
            '현금흐름 저장 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.',
            'jvm_weekly_api_unreachable',
          ),
          metadata(attempt, upstreamStatus, true, mutation && sent ? 'uncertain' : (mutation ? 'not_started' : 'failed')),
        ));
      } finally {
        clearTimeout(timeout);
      }
    };

    const retryAllowed = retry !== false
      && (!mutation || Boolean(readOptionalText(body?.idempotencyKey)));

    try {
      return await send(1);
    } catch (error) {
      if (!error?.transportFailure) throw error;
      if (callerDeadlineReached()) throw callerDeadlineError(1, error.mutationOutcome);
      if (!retryAllowed) throw error;
      try {
        return await send(2);
      } catch (retryError) {
        if (!retryError?.transportFailure) throw retryError;
        if (callerDeadlineReached()) throw callerDeadlineError(2, retryError.mutationOutcome);
        throw retryError;
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
      command: 'get_cashflow_snapshot',
    });
  }

  async function getCashflowSheetOperationStatus({ context, projectId, operationType, idempotencyKey }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    const normalizedOperationType = readOptionalText(operationType);
    const normalizedIdempotencyKey = readOptionalText(idempotencyKey);
    if (!normalizedProjectId) throw createHttpError(400, 'projectId is required.', 'project_id_required');
    if (!['MONTH_APPLY', 'BATCH_APPLY', 'ANNUAL_APPLY'].includes(normalizedOperationType)) {
      throw createHttpError(400, 'operationType is invalid.', 'cashflow_sheet_operation_type_invalid');
    }
    if (!normalizedIdempotencyKey) {
      throw createHttpError(400, 'idempotencyKey is required.', 'idempotency_key_required');
    }
    return requestJson({
      context,
      method: 'GET',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/operations?operationType=${encodeURIComponent(normalizedOperationType)}&idempotencyKey=${encodeURIComponent(normalizedIdempotencyKey)}`,
      command: 'get_cashflow_sheet_operation_status',
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
    calculationChecks,
    openingBalanceCells = [],
    replaceAllActualSources = false,
    settledWeekChangeConfirmation = null,
    closedMonthChangeReason = '',
    acceptFormulaMismatches = false,
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
    }
    if (readOptionalText(env.BFF_DEPLOY_ENV).toLowerCase() !== 'stage') {
      throw createHttpError(503, '현재 환경에서는 캐시플로를 저장할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
      throw createHttpError(503, '서버 설정이 서로 맞지 않아 캐시플로를 사용할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_data_project_mismatch');
    }
    const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
    if (bffDataProjectId === liveProjectId) {
      throw createHttpError(503, '테스트 환경에서는 실제 운영 자료를 변경할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/apply`,
      command: 'apply_cashflow_sheet',
      dataProjectId: bffDataProjectId,
      body: {
        idempotencyKey,
        sourceRevision,
        targetRevision,
        yearMonth,
        cells,
        calculationChecks,
        ...(openingBalanceCells.length > 0 ? { openingBalanceCells } : {}),
        ...(replaceAllActualSources === true ? { replaceAllActualSources: true } : {}),
        ...(settledWeekChangeConfirmation ? { settledWeekChangeConfirmation } : {}),
        ...(readOptionalText(closedMonthChangeReason) ? { closedMonthChangeReason: readOptionalText(closedMonthChangeReason) } : {}),
        ...(acceptFormulaMismatches === true ? { acceptFormulaMismatches: true } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
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
    openingBalanceCells = [],
    replaceAllActualSources = false,
    settledWeekChangeConfirmation = null,
    closedMonthChangeReason = '',
    acceptFormulaMismatches = false,
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
    }
    if (readOptionalText(env.BFF_DEPLOY_ENV).toLowerCase() !== 'stage') {
      throw createHttpError(503, '현재 환경에서는 캐시플로를 저장할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
      throw createHttpError(503, '서버 설정이 서로 맞지 않아 캐시플로를 사용할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_data_project_mismatch');
    }
    const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
    if (bffDataProjectId === liveProjectId) {
      throw createHttpError(503, '테스트 환경에서는 실제 운영 자료를 변경할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/batch/apply`,
      command: 'apply_cashflow_sheet_batch',
      dataProjectId: bffDataProjectId,
      attemptTimeoutMs: 24_000,
      retry: false,
      body: {
        idempotencyKey,
        sourceRevision,
        targetRevision,
        months,
        ...(openingBalanceCells.length > 0 ? { openingBalanceCells } : {}),
        ...(replaceAllActualSources === true ? { replaceAllActualSources: true } : {}),
        ...(settledWeekChangeConfirmation ? { settledWeekChangeConfirmation } : {}),
        ...(readOptionalText(closedMonthChangeReason) ? { closedMonthChangeReason: readOptionalText(closedMonthChangeReason) } : {}),
        ...(acceptFormulaMismatches === true ? { acceptFormulaMismatches: true } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
    }
    return result;
  }

  async function validateCashflowSheetFormulas({
    context,
    projectId,
    sourceYear,
    annualCells,
    annualDerivedCells,
    months,
    acceptFormulaMismatches = false,
  }) {
    const normalizedProjectId = encodeURIComponent(readOptionalText(projectId));
    if (!normalizedProjectId) {
      throw createHttpError(400, 'projectId is required.', 'project_id_required');
    }
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/formulas/preflight`,
      command: 'validate_cashflow_sheet_formulas',
      mutation: false,
      dataProjectId: bffDataProjectId,
      body: {
        sourceYear,
        annualCells,
        annualDerivedCells,
        months,
        ...(acceptFormulaMismatches === true ? { acceptFormulaMismatches: true } : {}),
      },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
    }
    const annualCheckCount = annualDerivedCells.length / 3;
    const weeklyCheckCount = months.reduce(
      (count, month) => count + (Array.isArray(month?.calculationChecks) ? month.calculationChecks.length : 0),
      0,
    );
    if (
      result?.ok !== true
      || !Number.isSafeInteger(result?.annualCheckCount)
      || result.annualCheckCount < 0
      || result.annualCheckCount !== annualCheckCount
      || !Number.isSafeInteger(result?.weeklyCheckCount)
      || result.weeklyCheckCount < 0
      || result.weeklyCheckCount !== weeklyCheckCount
    ) {
      throw createHttpError(502, 'JVM 수식 검증 결과가 불완전해 반영을 확인할 수 없습니다.', 'jvm_weekly_response_invalid');
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
      throw createHttpError(503, '현재 환경에서는 캐시플로를 저장할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    if (!bffDataProjectId || !firestoreProjectId || bffDataProjectId !== firestoreProjectId) {
      throw createHttpError(503, '서버 설정이 서로 맞지 않아 캐시플로를 사용할 수 없습니다. 담당자에게 문의해 주세요.', 'jvm_weekly_data_project_mismatch');
    }
    const liveProjectId = readOptionalText(env.BFF_LIVE_FIREBASE_PROJECT_ID) || 'inner-platform-live-20260316';
    if (bffDataProjectId === liveProjectId) {
      throw createHttpError(503, '테스트 환경에서는 실제 운영 자료를 변경할 수 없습니다. 담당자에게 문의해 주세요.', 'unsafe_bff_runtime');
    }
    const result = await requestJson({
      context,
      method: 'POST',
      path: `/api/v1/cashflow/${normalizedProjectId}/sheet-lab/annual/apply`,
      command: 'apply_cashflow_annual_total',
      dataProjectId: bffDataProjectId,
      body: { idempotencyKey, sourceRevision, year, expectedRevision, cells },
    });
    if (readOptionalText(result?.projectId) !== readOptionalText(projectId)) {
      throw createHttpError(502, '다른 프로젝트의 자료가 도착했습니다. 화면을 새로고침해 주세요.', 'jvm_weekly_project_mismatch');
    }
    return result;
  }

  return {
    requestJson,
    getCashflowSnapshot,
    getCashflowSheetOperationStatus,
    applyCashflowSheetLab,
    applyCashflowSheetBatch,
    validateCashflowSheetFormulas,
    applyCashflowSheetAnnualTotal,
    authMode,
    workspaceEmailDomain,
    firestoreProjectId,
    bffDataProjectId,
  };
}
