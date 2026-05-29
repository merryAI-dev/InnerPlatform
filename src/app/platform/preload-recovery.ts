type PreloadRecoveryTarget = Pick<Window, 'addEventListener' | 'dispatchEvent'> & {
  location: Pick<Location, 'pathname'>;
  sessionStorage?: Pick<Storage, 'getItem' | 'setItem'>;
};

let reportRequested = false;
const PRELOAD_RECOVERY_SESSION_KEY = 'mysc:vite-preload-recovery';
const PRELOAD_RECOVERY_THROTTLE_MS = 30_000;

function shouldReportPreloadError(target: PreloadRecoveryTarget): boolean {
  if (reportRequested) return false;

  const path = target.location.pathname || '/';
  const now = Date.now();
  const sessionStorage = target.sessionStorage;
  if (!sessionStorage) {
    reportRequested = true;
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

  reportRequested = true;
  return true;
}

export function installVitePreloadRecovery(target: PreloadRecoveryTarget = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    const customEvent = event as unknown as CustomEvent<{ message?: string } | undefined>;
    customEvent.preventDefault();
    console.warn('[MYSC] Vite preload error detected:', customEvent.detail);
    target.dispatchEvent(new CustomEvent('mysc:preloadError', {
      detail: {
        route: target.location.pathname || '/',
        source: 'vite:preloadError',
        originalDetail: customEvent.detail,
      },
    }));

    if (!shouldReportPreloadError(target)) {
      console.error('[MYSC] Vite preload error already reported recently; keeping current URL without auto reload.');
      return;
    }

    console.warn('[MYSC] Keeping current URL. User must choose when to refresh after saving current work.');
  });
}
