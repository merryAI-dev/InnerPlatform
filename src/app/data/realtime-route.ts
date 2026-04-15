import { useSyncExternalStore } from 'react';

const LOCATION_CHANGE_EVENT = 'mysc:location-change';

let historyPatched = false;

function dispatchLocationChange() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function patchHistoryEvents() {
  if (historyPatched || typeof window === 'undefined') return;
  historyPatched = true;

  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = ((...args: Parameters<History['pushState']>) => {
    const result = originalPushState(...args);
    dispatchLocationChange();
    return result;
  }) as History['pushState'];

  window.history.replaceState = ((...args: Parameters<History['replaceState']>) => {
    const result = originalReplaceState(...args);
    dispatchLocationChange();
    return result;
  }) as History['replaceState'];
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  patchHistoryEvents();
  window.addEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  window.addEventListener('popstate', onStoreChange);
  return () => {
    window.removeEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
    window.removeEventListener('popstate', onStoreChange);
  };
}

function getSnapshot() {
  if (typeof window === 'undefined') return '';
  return window.location.pathname || '';
}

export function useRealtimeRoutePathname(): string {
  return useSyncExternalStore(subscribe, getSnapshot, () => '');
}
