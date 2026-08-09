import { performance } from 'node:perf_hooks';

const SAFE_TEXT = /^[a-zA-Z0-9_.:-]+$/;

function safeText(value, fallback = 'unknown') {
  const text = typeof value === 'string' ? value.trim().slice(0, 128) : '';
  return text && SAFE_TEXT.test(text) ? text : fallback;
}

function safeDuration(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function safeErrorCode(value) {
  const code = safeText(value, 'unknown');
  return /^(?:cashflow_|java_|jvm_)[a-z0-9_]+$/.test(code)
    || ['AbortError', 'Error', 'TypeError'].includes(code)
    ? code
    : 'unknown';
}

function defaultLogger(payload) {
  if (process.env.NODE_ENV === 'test') return;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export function createCashflowPerformanceTrace({
  requestId,
  operation,
  logger = defaultLogger,
  now = () => performance.now(),
} = {}) {
  const startedAt = now();

  const emit = (phase, details = {}) => {
    const payload = {
      severity: details.outcome === 'error' ? 'WARNING' : 'INFO',
      message: 'cashflow.performance',
      requestId: safeText(requestId),
      operation: safeText(operation),
      phase: safeText(phase),
      ...(Number.isSafeInteger(details.attempt) ? { attempt: details.attempt } : {}),
      ...(details.outcome ? { outcome: safeText(details.outcome) } : {}),
      ...(Number.isInteger(details.statusCode) ? { statusCode: details.statusCode } : {}),
      ...(Number.isInteger(details.upstreamStatus) ? { upstreamStatus: details.upstreamStatus } : {}),
      ...(typeof details.retryable === 'boolean' ? { retryable: details.retryable } : {}),
      ...(details.errorCode ? { errorCode: safeErrorCode(details.errorCode) } : {}),
      durationMs: safeDuration(details.durationMs),
      totalMs: safeDuration(now() - startedAt),
    };
    if (logger === defaultLogger && process.env.NODE_ENV === 'test') return;
    setImmediate(() => {
      try {
        logger(payload);
      } catch {
        // Diagnostics must never affect the request being measured.
      }
    }).unref?.();
  };

  const measure = async (phase, task, details = {}) => {
    const phaseStartedAt = now();
    try {
      const result = await task();
      emit(phase, { ...details, outcome: 'ok', durationMs: now() - phaseStartedAt });
      return result;
    } catch (error) {
      emit(phase, {
        ...details,
        outcome: 'error',
        statusCode: error?.statusCode,
        errorCode: error?.code || error?.name,
        durationMs: now() - phaseStartedAt,
      });
      throw error;
    }
  };

  const measureSync = (phase, task, details = {}) => {
    const phaseStartedAt = now();
    try {
      const result = task();
      emit(phase, { ...details, outcome: 'ok', durationMs: now() - phaseStartedAt });
      return result;
    } catch (error) {
      emit(phase, {
        ...details,
        outcome: 'error',
        statusCode: error?.statusCode,
        errorCode: error?.code || error?.name,
        durationMs: now() - phaseStartedAt,
      });
      throw error;
    }
  };

  return { emit, measure, measureSync };
}
