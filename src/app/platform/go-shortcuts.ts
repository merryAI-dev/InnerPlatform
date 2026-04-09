const GO_SHORTCUT_TARGETS = {
  d: '/',
  p: '/projects',
  m: '/projects/migration-audit',
  c: '/cashflow',
  e: '/evidence',
  s: '/settings',
} as const;

export type GoShortcutToken = keyof typeof GO_SHORTCUT_TARGETS;

export function resolveGoShortcutTarget(token: string): string | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  return GO_SHORTCUT_TARGETS[normalized as GoShortcutToken] ?? null;
}
