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
  return /(token|authorization|password|secret|credential|privatekey|contentbase64|rawtext|googleaccesstoken|idtoken|email)/i.test(key);
}

function truncateString(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
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
  if (error instanceof Error) {
    const maybe = error as Error & { status?: number; requestId?: string };
    return {
      name: error.name || 'Error',
      message: error.message,
      status: typeof maybe.status === 'number' ? maybe.status : undefined,
      requestId: typeof maybe.requestId === 'string' ? maybe.requestId : undefined,
    };
  }
  return {
    name: 'UnknownError',
    message: String(error),
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
