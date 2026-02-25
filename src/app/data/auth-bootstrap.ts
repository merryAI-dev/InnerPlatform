import { normalizeEmail } from './auth-helpers';

// Keep frontend bootstrap defaults aligned with Firestore rules.
export const DEFAULT_BOOTSTRAP_ADMIN_EMAILS: readonly string[] = [
  'ai@mysc.co.kr',
  'admin@mysc.co.kr',
];

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
