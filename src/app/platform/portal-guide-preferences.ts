export interface PortalGuidePreferenceScope {
  guideId: string;
  uid?: string | null;
}

function buildPortalGuidePreferenceKey(scope: PortalGuidePreferenceScope): string | null {
  const uid = String(scope.uid || '').trim();
  const guideId = String(scope.guideId || '').trim();
  if (!uid || !guideId) return null;
  return `mysc-portal-guide-ack:${uid}:${guideId}`;
}

export function readPortalGuideAcknowledged(
  scope: PortalGuidePreferenceScope,
  storage: Pick<Storage, 'getItem'> | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
): boolean {
  const key = buildPortalGuidePreferenceKey(scope);
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function writePortalGuideAcknowledged(
  scope: PortalGuidePreferenceScope,
  acknowledged: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
): void {
  const key = buildPortalGuidePreferenceKey(scope);
  if (!key || !storage) return;
  try {
    if (acknowledged) {
      storage.setItem(key, 'true');
      return;
    }
    storage.removeItem(key);
  } catch {
    // localStorage can fail in private mode; silently ignore.
  }
}
