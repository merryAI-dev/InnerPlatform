const DEFAULT_LOCAL_PLATFORM_API_BASE_URL = 'http://127.0.0.1:8787';

export interface NormalizePlatformApiBaseUrlOptions {
  requireConfigured?: boolean;
  fallback?: string;
  rejectBrowserRewriteHosts?: boolean;
  errorPrefix?: string;
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isBrowserRewriteHost(host: string): boolean {
  return host === 'inner-platform.vercel.app'
    || host.endsWith('.vercel.app')
    || host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0';
}

export function normalizePlatformApiBaseUrl(
  value: unknown,
  options: NormalizePlatformApiBaseUrlOptions = {},
): string {
  const fallback = options.fallback ?? DEFAULT_LOCAL_PLATFORM_API_BASE_URL;
  const prefix = options.errorPrefix || 'VITE_PLATFORM_API_BASE_URL';
  if (typeof value !== 'string' || !value.trim()) {
    if (options.requireConfigured) {
      throw new Error(`${prefix} is required for stage/live platform API operation.`);
    }
    return fallback;
  }

  const normalized = value.trim().replace(/\/$/, '');
  if (options.rejectBrowserRewriteHosts) {
    const host = hostOf(normalized);
    if (!normalized.startsWith('https://') || !host) {
      throw new Error(`${prefix} must be an absolute https Java API URL for stage/live platform API operation.`);
    }
    if (isBrowserRewriteHost(host)) {
      throw new Error(`${prefix} must bypass Vercel/BFF rewrites for stage/live platform API operation.`);
    }
  }
  return normalized;
}

