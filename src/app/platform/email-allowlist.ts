const DEFAULT_ALLOWED_DOMAINS = ['mysc.co.kr'];

function normalizeDomain(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const withoutAt = raw.startsWith('@') ? raw.slice(1) : raw;
  return withoutAt.replace(/\s+/g, '');
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function parseAllowedEmailDomains(raw: unknown, fallback: string[] = DEFAULT_ALLOWED_DOMAINS): string[] {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return [...fallback];
  return text
    .split(',')
    .map((part) => normalizeDomain(part))
    .filter(Boolean);
}

export function getAllowedEmailDomains(env: Record<string, unknown> = import.meta.env): string[] {
  return parseAllowedEmailDomains(env.VITE_ALLOWED_EMAIL_DOMAINS, DEFAULT_ALLOWED_DOMAINS);
}

export function isAllowedEmail(email: unknown, allowedDomains: string[] = DEFAULT_ALLOWED_DOMAINS): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) return false;
  const domain = normalized.split('@').pop() || '';
  return allowedDomains.some((allowed) => domain === normalizeDomain(allowed));
}

export function formatAllowedDomains(allowedDomains: string[]): string {
  const list = allowedDomains.map((d) => `@${normalizeDomain(d)}`).filter(Boolean);
  return list.length ? list.join(', ') : '(none)';
}

