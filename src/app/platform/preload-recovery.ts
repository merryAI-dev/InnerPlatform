type PreloadRecoveryTarget = Pick<Window, 'addEventListener'> & {
  location: Pick<Location, 'pathname' | 'reload'>;
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
};

let reloadRequested = false;
const PRELOAD_RECOVERY_SESSION_KEY = 'mysc:vite-preload-recovery';
const PRELOAD_RECOVERY_THROTTLE_MS = 30_000;

function shouldReloadForPreloadError(target: PreloadRecoveryTarget): boolean {
  if (reloadRequested) return false;

  const path = target.location.pathname || '/';
  const now = Date.now();
  const sessionStorage = target.sessionStorage;
  if (!sessionStorage) {
    reloadRequested = true;
    return true;
  }

  try {
    const previous = JSON.parse(sessionStorage.getItem(PRELOAD_RECOVERY_SESSION_KEY) || 'null') as {
      path?: string;
      requestedAt?: number;
    } | null;
    if (
      previous?.path === path
      && typeof previous.requestedAt === 'number'
      && now - previous.requestedAt < PRELOAD_RECOVERY_THROTTLE_MS
    ) {
      return false;
    }

    sessionStorage.setItem(PRELOAD_RECOVERY_SESSION_KEY, JSON.stringify({ path, requestedAt: now }));
  } catch {
    // Storage can be blocked in some auth/browser modes. Fall back to in-memory protection.
  }

  reloadRequested = true;
  return true;
}

export function installVitePreloadRecovery(target: PreloadRecoveryTarget = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    const customEvent = event as unknown as CustomEvent<{ message?: string } | undefined>;
    customEvent.preventDefault();
    console.warn('[MYSC] Vite preload error detected:', customEvent.detail);

    if (!shouldReloadForPreloadError(target)) {
      console.error('[MYSC] Vite preload recovery already attempted recently; keeping current URL without another reload.');
      return;
    }

    console.warn('[MYSC] Reloading app shell once to recover stale chunks.');
    target.location.reload();
  });
}
