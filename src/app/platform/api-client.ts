import {
  buildStandardHeaders,
  type BuildStandardHeadersInput,
  type RequestActor,
} from './request-context';

const DEFAULT_RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ApiResponse<T> {
  status: number;
  requestId: string;
  data: T;
  headers: Headers;
}

export interface PlatformRequestOptions {
  method?: string;
  tenantId: string;
  actor: RequestActor;
  headers?: HeadersInit;
  body?: unknown;
  idempotencyKey?: string;
  requestId?: string;
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
  retryOnStatuses?: number[];
}

export interface PlatformApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  retryOnStatuses?: number[];
  timeoutMs?: number;
}

export class PlatformApiError extends Error {
  status: number;
  requestId?: string;
  body?: unknown;

  constructor(message: string, status: number, requestId?: string, body?: unknown) {
    super(message);
    this.name = 'PlatformApiError';
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

function normalizeRetryCount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function normalizeDelay(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableMethod(method: string, headers: Headers): boolean {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    return headers.has('idempotency-key');
  }
  return false;
}

function buildRequestUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (!baseUrl) return path;
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) {
    return null;
  }

  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

export class PlatformApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly retryOnStatuses: Set<number>;
  private readonly timeoutMs: number;

  constructor(options: PlatformApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl || fetch;
    this.maxRetries = normalizeRetryCount(options.maxRetries);
    this.retryDelayMs = normalizeDelay(options.retryDelayMs, 150);
    this.retryOnStatuses = new Set(options.retryOnStatuses || Array.from(DEFAULT_RETRY_STATUSES));
    this.timeoutMs = normalizeDelay(options.timeoutMs, 0);
  }

  private async executeFetch(
    url: string,
    init: RequestInit,
    externalSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<Response> {
    if (!timeoutMs) {
      return this.fetchImpl(url, { ...init, signal: externalSignal });
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;
    let onAbort: (() => void) | undefined;

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        onAbort = () => controller.abort();
        externalSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (didTimeout) {
        const timeoutError = new Error(`API request timed out after ${timeoutMs}ms`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal && onAbort) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  }

  private shouldRetryRequest(params: {
    error: unknown;
    attempt: number;
    maxRetries: number;
    method: string;
    headers: Headers;
    signal?: AbortSignal;
    retryOnStatuses: Set<number>;
  }): boolean {
    const {
      error,
      attempt,
      maxRetries,
      method,
      headers,
      signal,
      retryOnStatuses,
    } = params;

    if (attempt >= maxRetries) return false;
    if (!isRetryableMethod(method, headers)) return false;

    if (signal?.aborted && isAbortError(error)) {
      return false;
    }

    if (error instanceof PlatformApiError) {
      return retryOnStatuses.has(error.status);
    }

    if (isAbortError(error)) {
      return false;
    }

    return true;
  }

  private getRetryDelayMs(attempt: number): number {
    const delay = this.retryDelayMs * Math.pow(2, attempt);
    return Math.min(delay, 3000);
  }

  async request<T>(path: string, options: PlatformRequestOptions): Promise<ApiResponse<T>> {
    const method = (options.method || 'GET').toUpperCase();
    const requestUrl = buildRequestUrl(this.baseUrl, path);

    const headerInput: BuildStandardHeadersInput = {
      tenantId: options.tenantId,
      actor: options.actor,
      method,
      requestId: options.requestId,
      idempotencyKey: options.idempotencyKey,
      headers: options.headers,
    };

    const headers = buildStandardHeaders(headerInput);
    let body: BodyInit | undefined;

    if (options.body !== undefined && options.body !== null) {
      if (options.body instanceof FormData) {
        body = options.body;
      } else {
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        body = JSON.stringify(options.body);
      }
    }

    const maxRetries = normalizeRetryCount(options.retries ?? this.maxRetries);
    const timeoutMs = normalizeDelay(options.timeoutMs ?? this.timeoutMs, 0);
    const retryOnStatuses = new Set(options.retryOnStatuses || Array.from(this.retryOnStatuses));

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.executeFetch(
          requestUrl,
          {
            method,
            headers,
            body,
          },
          options.signal,
          timeoutMs,
        );

        const requestId = response.headers.get('x-request-id') || headers.get('x-request-id') || '';
        const responseBody = await readResponseBody(response);

        if (!response.ok) {
          throw new PlatformApiError(
            `API request failed with status ${response.status}`,
            response.status,
            requestId,
            responseBody,
          );
        }

        return {
          status: response.status,
          requestId,
          data: responseBody as T,
          headers: response.headers,
        };
      } catch (error) {
        const shouldRetry = this.shouldRetryRequest({
          error,
          attempt,
          maxRetries,
          method,
          headers,
          signal: options.signal,
          retryOnStatuses,
        });

        if (!shouldRetry) throw error;

        const delayMs = this.getRetryDelayMs(attempt);
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  }

  get<T>(path: string, options: Omit<PlatformRequestOptions, 'method'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, options: Omit<PlatformRequestOptions, 'method'>): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'POST' });
  }
}
