/**
 * Weekly Active Users (WAU) tracker.
 * Records user activity timestamps to Firestore for analytics.
 */

const WAU_STORAGE_KEY = 'innerplatform_wau_last_ping';
const WAU_PING_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export function shouldPingWau(): boolean {
  if (typeof window === 'undefined') return false;
  const last = window.localStorage.getItem(WAU_STORAGE_KEY);
  if (!last) return true;
  const elapsed = Date.now() - Number(last);
  return elapsed >= WAU_PING_INTERVAL_MS;
}

export function markWauPinged(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(WAU_STORAGE_KEY, String(Date.now()));
}

export interface WauPingPayload {
  uid: string;
  email: string;
  role: string;
  orgId: string;
  timestamp: string;
  userAgent: string;
}

export function buildWauPingPayload(user: {
  uid: string;
  email: string;
  role: string;
  orgId: string;
}): WauPingPayload {
  return {
    uid: user.uid,
    email: user.email,
    role: user.role,
    orgId: user.orgId,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
}
