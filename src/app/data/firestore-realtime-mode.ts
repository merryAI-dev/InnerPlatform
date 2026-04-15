export function normalizeRealtimeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function canUseRealtimeListeners(role: unknown): boolean {
  const normalized = normalizeRealtimeRole(role);
  return normalized === 'admin'
    || normalized === 'tenant_admin'
    || normalized === 'finance'
    || normalized === 'auditor';
}

export function shouldUseSafeFetchMode(role: unknown): boolean {
  return !canUseRealtimeListeners(role);
}
