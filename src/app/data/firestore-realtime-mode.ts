export function normalizeRealtimeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeRealtimePathname(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  if (typeof window !== 'undefined' && typeof window.location?.pathname === 'string') {
    return window.location.pathname.trim().toLowerCase();
  }
  return '';
}

function shouldForceSafeFetchForPath(pathname: unknown): boolean {
  const normalized = normalizeRealtimePathname(pathname);
  return normalized.startsWith('/portal') || normalized.startsWith('/viewer');
}

export function canUseRealtimeListeners(role: unknown, pathname?: unknown): boolean {
  if (shouldForceSafeFetchForPath(pathname)) return false;
  const normalized = normalizeRealtimeRole(role);
  return normalized === 'admin'
    || normalized === 'tenant_admin'
    || normalized === 'finance'
    || normalized === 'auditor';
}

export function shouldUseSafeFetchMode(role: unknown, pathname?: unknown): boolean {
  return !canUseRealtimeListeners(role, pathname);
}
