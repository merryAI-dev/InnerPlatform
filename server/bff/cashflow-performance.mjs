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
  // 응답 헤더(Server-Timing)로 내보낼 span 기록. 로그를 못 보는 자리(브라우저)에서도 분해가 보이게.
  const spans = [];

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
      ...(Number.isSafeInteger(details.projectCount) ? { projectCount: details.projectCount } : {}),
      ...(Number.isSafeInteger(details.itemCount) ? { itemCount: details.itemCount } : {}),
      ...(Number.isSafeInteger(details.issueCount) ? { issueCount: details.issueCount } : {}),
      durationMs: safeDuration(details.durationMs),
      totalMs: safeDuration(now() - startedAt),
    };
    if (details.outcome) spans.push({ phase: payload.phase, attempt: payload.attempt, durationMs: payload.durationMs, outcome: payload.outcome });
    if (logger === defaultLogger && process.env.NODE_ENV === 'test') return;
    if (logger === defaultLogger) {
      try {
        logger(payload);
      } catch {
        // Diagnostics must never affect the request being measured.
      }
      return;
    }
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

  // RFC 9297 Server-Timing. 이름은 phase(재시도면 phase.2), dur 은 ms 정수. 값 없는 진단은 넣지 않는다.
  const serverTiming = () => {
    const entries = spans.map((span) => {
      const name = span.attempt && span.attempt > 1 ? `${span.phase}.${span.attempt}` : span.phase;
      const desc = span.outcome === 'error' ? ';desc="error"' : '';
      return `${name};dur=${span.durationMs}${desc}`;
    });
    entries.push(`total;dur=${safeDuration(now() - startedAt)}`);
    return entries.join(', ');
  };

  return { emit, measure, measureSync, serverTiming };
}
