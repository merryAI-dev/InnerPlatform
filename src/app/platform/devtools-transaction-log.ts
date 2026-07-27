export type DevtoolsLogKind = 'bff_request' | 'cashflow_transaction';
export type DevtoolsLogPhase = 'start' | 'success' | 'error' | 'retry' | 'info';

export interface DevtoolsLogEntry {
  id: string;
  ts: string;
  kind: DevtoolsLogKind;
  phase: DevtoolsLogPhase;
  operation: string;
  method?: string;
  path?: string;
  requestId?: string;
  responseRequestId?: string;
  status?: number;
  durationMs?: number;
  attempt?: number;
  maxRetries?: number;
  tenantId?: string;
  actorId?: string;
  transport?: 'bff' | 'firestore' | 'local';
  projectId?: string;
  yearMonth?: string;
  weekNo?: number;
  mode?: 'projection' | 'actual';
  summary?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    status?: number;
    requestId?: string;
  };
}

interface DevtoolsApi {
  logs: () => DevtoolsLogEntry[];
  clear: () => void;
  enable: () => void;
  disable: () => void;
  isConsoleEnabled: () => boolean;
}

const globalState = globalThis as typeof globalThis & {
  __MYSCUBE_DEVTOOLS__?: DevtoolsApi;
  __MYSCUBE_DEVTOOLS_LOGS__?: DevtoolsLogEntry[];
};

const MAX_LOGS = 500;
const STORAGE_KEY = 'myscube:devtools-logs';
const REDACTED = '[redacted]';

function nowIso(): string {
  return new Date().toISOString();
}

function makeLogId(): string {
  return `log_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function isSensitiveKey(key: string): boolean {
  return /(token|authorization|password|secret|credential|privatekey|contentbase64|rawtext|googleaccesstoken|idtoken|email|message|detail|amount|cell|value|payload|body)/i.test(key);
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\b(authorization|bearer|access[_-]?token|id[_-]?token|googleaccess[_-]?token|password|secret|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b[A-Z]{1,3}\d{1,4}(?::[A-Z]{1,3}\d{1,4})?\b/g, '[cell]')
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\s*(?:원|KRW))?/gi, '[amount]')
    .replace(/\b\d{4,}\s*(?:원|KRW)?\b/gi, '[number]');
}

function truncateString(value: string): string {
  const redacted = redactSensitiveText(value);
  return redacted.length > 500 ? `${redacted.slice(0, 500)}...` : redacted;
}

// 진단 코드는 소문자와 밑줄로만 이루어진 2~8마디 식별자다. 실제 토큰·키·비밀번호는 base64,
// hex, JWT 형태라 이 모양을 만족할 수 없으므로 모양 검사만으로 값 유출을 막을 수 있다.
//
// 예전에는 여기에 token, secret, key 같은 단어가 들어간 코드를 버리는 목록이 있었다. 그 목록은
// 값이 아니라 이름을 보고 판단하기 때문에, 막아야 할 값은 어차피 모양 검사에서 걸리고 정작
// 인증 실패를 가리키는 코드만 사라졌다. jvm_weekly_api_token_unconfigured 와
// jvm_weekly_api_identity_token_unavailable 이 그렇게 로그에서 빠져 있었다.
const MAX_DIAGNOSTIC_CODE_LENGTH = 64;

export function toSafeDiagnosticCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_DIAGNOSTIC_CODE_LENGTH) return undefined;
  if (!/^(?:[a-z]+_){1,7}[a-z]+$/.test(value)) return undefined;
  return value;
}

function isSafeDiagnosticCode(value: unknown): value is string {
  return Boolean(toSafeDiagnosticCode(value));
}

export function sanitizeDevtoolsValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (depth >= 4) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeDevtoolsValue(item, depth + 1));
  }

  if (value instanceof Error) {
    return toDevtoolsError(value);
  }

  if (value instanceof Headers) {
    const out: Record<string, unknown> = {};
    value.forEach((headerValue, headerKey) => {
      out[headerKey] = isSensitiveKey(headerKey) ? REDACTED : truncateString(headerValue);
    });
    return out;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 60)) {
      out[key] = isSensitiveKey(key) ? REDACTED : sanitizeDevtoolsValue(child, depth + 1);
    }
    return out;
  }

  return String(value);
}

export function toDevtoolsError(error: unknown): DevtoolsLogEntry['error'] {
  const maybe = error as {
    name?: unknown;
    status?: unknown;
    requestId?: unknown;
    code?: unknown;
    body?: { code?: unknown; error?: unknown; message?: unknown };
  };
  // BFF 오류 응답은 { error, message, requestId } 형태다. 진단 코드는 body.error 에 담겨 오는데
  // 여기서는 body.code 만 보고 있어서 지금까지 어떤 코드도 로그에 남지 않았다.
  const code = [maybe?.code, maybe?.body?.code, maybe?.body?.error].find(isSafeDiagnosticCode);
  const name = typeof maybe?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(maybe.name)
    ? maybe.name
    : 'RequestError';
  // 서버가 직접 정한 문구는 무엇이 왜 실패했는지를 담고 있다. 화면에는 이 문구만 보이고
  // 코드는 개발자 도구에서만 확인한다. truncateString 이 길이 제한과 민감어 마스킹을 담당한다.
  // 이 함수의 반환값은 그 자체로 안전해야 한다. 마스킹은 recordDevtoolsLog 단계에도 있지만
  // toDevtoolsError 를 직접 쓰는 곳이 있으므로 여기서 먼저 거른다.
  const rawServerMessage = typeof maybe?.body?.message === 'string' ? maybe.body.message.trim() : '';
  const detail = rawServerMessage ? truncateString(rawServerMessage) : 'Request failed';
  return {
    name,
    message: code ? `[${code}] ${detail}` : detail,
    status: typeof maybe?.status === 'number' && Number.isInteger(maybe.status) && maybe.status >= 100 && maybe.status <= 599
      ? maybe.status
      : undefined,
    requestId: typeof maybe?.requestId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(maybe.requestId)
      ? maybe.requestId
      : undefined,
  };
}

export function summarizeAmountMap(amounts: Record<string, unknown> | undefined): Record<string, unknown> {
  const entries = Object.entries(amounts || {});
  const changedLineIds = entries.map(([lineId]) => lineId);
  const nonZeroLineIds = entries
    .filter(([, amount]) => Number(amount) !== 0)
    .map(([lineId]) => lineId);
  return {
    lineCount: entries.length,
    nonZeroLineCount: nonZeroLineIds.length,
    changedLineIds,
    nonZeroLineIds,
  };
}

function readStorageFlag(): string {
  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    return storage?.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStorageFlag(value: string): void {
  try {
    const storage = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
    storage?.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage can be unavailable in private or test environments.
  }
}

function resolveDefaultConsoleEnabled(): boolean {
  const flag = readStorageFlag();
  if (flag === '1') return true;
  if (flag === '0') return false;
  const host = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  return host === 'localhost' || host === '127.0.0.1' || host.includes('stage');
}

export function isDevtoolsConsoleEnabled(): boolean {
  return resolveDefaultConsoleEnabled();
}

function ensureDevtoolsApi(): DevtoolsApi {
  if (!globalState.__MYSCUBE_DEVTOOLS_LOGS__) {
    globalState.__MYSCUBE_DEVTOOLS_LOGS__ = [];
  }
  if (!globalState.__MYSCUBE_DEVTOOLS__) {
    globalState.__MYSCUBE_DEVTOOLS__ = {
      logs: () => [...(globalState.__MYSCUBE_DEVTOOLS_LOGS__ || [])],
      clear: () => {
        globalState.__MYSCUBE_DEVTOOLS_LOGS__ = [];
      },
      enable: () => writeStorageFlag('1'),
      disable: () => writeStorageFlag('0'),
      isConsoleEnabled: () => isDevtoolsConsoleEnabled(),
    };
  }
  return globalState.__MYSCUBE_DEVTOOLS__;
}

export function formatDevtoolsConsoleLabel(entry: DevtoolsLogEntry): string {
  return `[MYSCube:${entry.kind}] ${entry.phase} ${entry.operation}${entry.requestId ? ` (${entry.requestId})` : ''}${typeof entry.durationMs === 'number' ? ` ${entry.durationMs}ms` : ''}`;
}

function writeConsole(entry: DevtoolsLogEntry): void {
  if (!isDevtoolsConsoleEnabled() || typeof console === 'undefined') return;
  const level = entry.phase === 'error' ? 'error' : entry.phase === 'retry' ? 'warn' : 'info';
  const label = formatDevtoolsConsoleLabel(entry);
  if (typeof console.groupCollapsed === 'function') {
    console.groupCollapsed(label);
    console[level](entry);
    console.groupEnd();
    return;
  }
  console[level](label, entry);
}

export function recordDevtoolsLog(input: Omit<DevtoolsLogEntry, 'id' | 'ts'> & Partial<Pick<DevtoolsLogEntry, 'id' | 'ts'>>): DevtoolsLogEntry {
  const api = ensureDevtoolsApi();
  const entry: DevtoolsLogEntry = {
    ...input,
    id: input.id || makeLogId(),
    ts: input.ts || nowIso(),
    summary: input.summary ? sanitizeDevtoolsValue(input.summary) as Record<string, unknown> : undefined,
    error: input.error ? sanitizeDevtoolsValue(input.error) as DevtoolsLogEntry['error'] : undefined,
  };
  const logs = globalState.__MYSCUBE_DEVTOOLS_LOGS__ || [];
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
  globalState.__MYSCUBE_DEVTOOLS_LOGS__ = logs;
  writeConsole(entry);
  return entry;
}

export function getDevtoolsLogs(): DevtoolsLogEntry[] {
  return ensureDevtoolsApi().logs();
}

export function clearDevtoolsLogs(): void {
  ensureDevtoolsApi().clear();
}

ensureDevtoolsApi();
