
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { initObservability, installGlobalObservabilityHandlers } from './app/platform/observability';
import './styles/index.css';

const VITE_PRELOAD_RECOVERY_KEY = '__mysc_vite_preload_recovery__';

function installVitePreloadRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    const customEvent = event as unknown as CustomEvent<{ message?: string } | undefined>;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const lastRecoveredPath = window.sessionStorage.getItem(VITE_PRELOAD_RECOVERY_KEY);

    if (lastRecoveredPath === currentPath) {
      window.sessionStorage.removeItem(VITE_PRELOAD_RECOVERY_KEY);
      return;
    }

    customEvent.preventDefault();
    window.sessionStorage.setItem(VITE_PRELOAD_RECOVERY_KEY, currentPath);
    window.location.reload();
  });

  window.addEventListener('pageshow', () => {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const lastRecoveredPath = window.sessionStorage.getItem(VITE_PRELOAD_RECOVERY_KEY);
    if (lastRecoveredPath === currentPath) {
      window.sessionStorage.removeItem(VITE_PRELOAD_RECOVERY_KEY);
    }
  });
}

installVitePreloadRecovery();
initObservability(import.meta.env);
installGlobalObservabilityHandlers();

createRoot(document.getElementById('root')!).render(<App />);
  
