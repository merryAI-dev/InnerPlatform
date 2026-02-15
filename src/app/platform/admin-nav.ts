function normalizeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

const FULL_ACCESS_ROLES = new Set(['admin', 'tenant_admin']);

const FINANCE_ALLOWED = new Set([
  '/',
  '/projects',
  '/board',
  '/cashflow',
  '/evidence',
  '/budget-summary',
  '/expense-management',
  '/approvals',
  '/audit',
  '/portal',
]);

const AUDITOR_ALLOWED = new Set([
  '/',
  '/projects',
  '/board',
  '/cashflow',
  '/evidence',
  '/budget-summary',
  '/expense-management',
  '/audit',
  '/portal',
]);

const SUPPORT_ALLOWED = new Set([
  '/',
  '/projects',
  '/board',
  '/evidence',
  '/audit',
  '/portal',
]);

const SECURITY_ALLOWED = new Set([
  '/',
  '/projects',
  '/board',
  '/audit',
]);

/**
 * UI-level navigation policy for the admin space (AppLayout).
 * This is intentionally opinionated to keep role experiences clean:
 * - finance/auditor shouldn't see HR menus or "new project" CTA
 * - operational settings are admin-scoped
 */
export function canShowAdminNavItem(role: unknown, to: string): boolean {
  const normalized = normalizeRole(role);
  if (!normalized) return false;

  if (FULL_ACCESS_ROLES.has(normalized)) return true;
  if (normalized === 'finance') return FINANCE_ALLOWED.has(to);
  if (normalized === 'auditor') return AUDITOR_ALLOWED.has(to);
  if (normalized === 'support') return SUPPORT_ALLOWED.has(to);
  if (normalized === 'security') return SECURITY_ALLOWED.has(to);

  // Unknown roles should not be encouraged to navigate into admin-only areas.
  return false;
}

function canonicalizeAdminPath(pathname: string): string | undefined {
  if (pathname === '/') return '/';

  if (pathname.startsWith('/projects/new')) return '/projects/new';
  if (pathname.startsWith('/projects/') && pathname.endsWith('/edit')) return '/projects/new';
  if (pathname === '/projects' || pathname.startsWith('/projects/')) return '/projects';

  const prefixes = [
    '/cashflow',
    '/evidence',
    '/budget-summary',
    '/expense-management',
    '/approvals',
    '/users',
    '/audit',
    '/settings',
    '/participation',
    '/koica-personnel',
    '/personnel-changes',
    '/hr-announcements',
  ];
  for (const p of prefixes) {
    if (pathname === p || pathname.startsWith(p + '/')) return p;
  }

  return undefined;
}

/**
 * Route-level guard for the admin space.
 *
 * For unknown paths we return true so the router can display NotFoundPage
 * instead of forcing a redirect.
 */
export function canAccessAdminPath(role: unknown, pathname: string): boolean {
  const canonical = canonicalizeAdminPath(pathname);
  if (!canonical) return true;
  return canShowAdminNavItem(role, canonical);
}
