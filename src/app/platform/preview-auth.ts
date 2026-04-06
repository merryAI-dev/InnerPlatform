function normalizeHost(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^https?:\/\//, '');
  return withoutProtocol.replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}

function parseHostList(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeHost(entry))
    .filter(Boolean);
}

function normalizeUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return '';
  if (trimmed === '/login' || trimmed === '/workspace-select') return '';
  return trimmed;
}

export interface PreviewAuthGuardConfig {
  allowedHosts: string[];
  fallbackUrl: string;
}

export function readPreviewAuthGuardConfig(
  env: Record<string, unknown> = import.meta.env,
): PreviewAuthGuardConfig {
  const fallbackUrl = normalizeUrl(env.VITE_FIREBASE_AUTH_FALLBACK_URL);
  const allowedHosts = new Set(parseHostList(env.VITE_FIREBASE_AUTH_ALLOWED_HOSTS));
  if (fallbackUrl) {
    try {
      allowedHosts.add(normalizeHost(new URL(fallbackUrl).host));
    } catch {
      // noop
    }
  }
  return {
    allowedHosts: Array.from(allowedHosts),
    fallbackUrl,
  };
}

export function buildPreviewAuthFallbackUrl(
  fallbackUrl: unknown,
  requestedPath?: unknown,
): string {
  const normalizedFallback = normalizeUrl(fallbackUrl);
  if (!normalizedFallback) return '';
  const redirect = normalizeRedirectPath(requestedPath);
  if (!redirect) return normalizedFallback;
  const url = new URL(normalizedFallback);
  url.searchParams.set('redirect', redirect);
  return url.toString();
}

export function isLocalAuthHost(hostname: unknown): boolean {
  const normalized = normalizeHost(hostname);
  return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(normalized);
}

export function isStableVercelPreviewHost(hostname: unknown): boolean {
  const normalized = normalizeHost(hostname);
  return normalized.endsWith('.vercel.app') && normalized.includes('-git-');
}

export function isStableVercelAliasHost(hostname: unknown): boolean {
  const normalized = normalizeHost(hostname);
  if (!normalized.endsWith('.vercel.app')) return false;
  const label = normalized.slice(0, -'.vercel.app'.length);
  if (!label) return false;
  if (label.includes('-git-')) return true;
  if (!label.includes('-')) return true;
  return !/-[a-z0-9]*\d[a-z0-9]*-/.test(label);
}

export function shouldBlockFirebasePopupAuth(
  hostname: unknown,
  env: Record<string, unknown> = import.meta.env,
): boolean {
  const normalized = normalizeHost(hostname);
  if (!normalized || isLocalAuthHost(normalized)) return false;
  if (!normalized.endsWith('.vercel.app')) return false;

  const config = readPreviewAuthGuardConfig(env);
  if (config.allowedHosts.includes(normalized)) return false;
  if (isStableVercelPreviewHost(normalized)) return false;
  if (isStableVercelAliasHost(normalized)) return false;
  return true;
}

export function buildPreviewAuthBlockedMessage(
  hostname: unknown,
  env: Record<string, unknown> = import.meta.env,
): string {
  const normalized = normalizeHost(hostname);
  const config = readPreviewAuthGuardConfig(env);
  if (config.fallbackUrl) {
    return `랜덤 Vercel preview에서는 Google 로그인을 막습니다. ${normalized || '현재 주소'} 대신 고정 preview 주소에서 로그인해 주세요.`;
  }
  return `랜덤 Vercel preview에서는 Google 로그인을 막습니다. ${normalized || '현재 주소'} 대신 Firebase Authorized Domains에 등록한 고정 preview 주소를 사용해 주세요.`;
}
