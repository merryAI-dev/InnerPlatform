import { normalizeEmail } from './auth-helpers';

// Bootstrap admin emails are loaded exclusively from VITE_BOOTSTRAP_ADMIN_EMAILS env var.
// Do NOT hardcode emails here — they end up in the client bundle.
export const DEFAULT_BOOTSTRAP_ADMIN_EMAILS: readonly string[] = [];

export function parseBootstrapAdminEmails(
  env: Record<string, unknown> = import.meta.env,
): string[] {
  const csv = typeof env.VITE_BOOTSTRAP_ADMIN_EMAILS === 'string' ? env.VITE_BOOTSTRAP_ADMIN_EMAILS : '';
  const single = typeof env.VITE_BOOTSTRAP_ADMIN_EMAIL === 'string' ? env.VITE_BOOTSTRAP_ADMIN_EMAIL : '';

  const fromEnv = [...csv.split(','), single]
    .map((value) => normalizeEmail(value))
    .filter(Boolean);

  return Array.from(new Set([
    ...DEFAULT_BOOTSTRAP_ADMIN_EMAILS.map((value) => normalizeEmail(value)),
    ...fromEnv,
  ]));
}

export function isBootstrapAdminEmail(
  email: string,
  env: Record<string, unknown> = import.meta.env,
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return parseBootstrapAdminEmails(env).includes(normalized);
}
