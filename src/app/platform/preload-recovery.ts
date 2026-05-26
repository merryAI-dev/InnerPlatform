type PreloadRecoveryTarget = Pick<Window, 'addEventListener' | 'location'>;

let reloadRequested = false;

export function installVitePreloadRecovery(target: PreloadRecoveryTarget = window): void {
  target.addEventListener('vite:preloadError', (event) => {
    const customEvent = event as unknown as CustomEvent<{ message?: string } | undefined>;
    customEvent.preventDefault();
    console.warn('[MYSC] Vite preload error detected; reloading app shell:', customEvent.detail);

    if (reloadRequested) return;
    reloadRequested = true;
    target.location.reload();
  });
}
