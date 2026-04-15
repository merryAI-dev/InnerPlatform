import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

export type FirestoreRouteMode = 'safe' | 'admin-live' | 'portal-safe';

export interface FirestoreAccessPolicy {
  routeMode: FirestoreRouteMode;
  allowRealtimeListeners: boolean;
  allowPrivilegedReadAll: boolean;
  useSafeFetchMode: boolean;
}

const PRIVILEGED_REALTIME_ROLES = new Set(['admin', 'tenant_admin', 'finance', 'auditor']);

const FirestoreRouteModeContext = createContext<FirestoreRouteMode>('safe');

export function normalizeRealtimeRole(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function canRoleUseOperationalRealtime(role: unknown): boolean {
  return PRIVILEGED_REALTIME_ROLES.has(normalizeRealtimeRole(role));
}

export function resolveFirestoreAccessPolicy(
  routeMode: FirestoreRouteMode,
  role: unknown,
): FirestoreAccessPolicy {
  const privileged = routeMode === 'admin-live' && canRoleUseOperationalRealtime(role);
  return {
    routeMode,
    allowRealtimeListeners: privileged,
    allowPrivilegedReadAll: privileged,
    useSafeFetchMode: !privileged,
  };
}

export function FirestoreRouteModeProvider({
  mode,
  children,
}: {
  mode: FirestoreRouteMode;
  children: ReactNode;
}) {
  return createElement(FirestoreRouteModeContext.Provider, { value: mode }, children);
}

export function useFirestoreRouteMode(): FirestoreRouteMode {
  return useContext(FirestoreRouteModeContext);
}

export function useFirestoreAccessPolicy(role: unknown): FirestoreAccessPolicy {
  const routeMode = useFirestoreRouteMode();
  return useMemo(() => resolveFirestoreAccessPolicy(routeMode, role), [routeMode, role]);
}
