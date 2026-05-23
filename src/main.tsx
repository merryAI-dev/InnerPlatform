
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { initObservability, installGlobalObservabilityHandlers } from './app/platform/observability';
import './styles/index.css';

function installVitePreloadRecovery(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', (event) => {
    const customEvent = event as unknown as CustomEvent<{ message?: string } | undefined>;
    customEvent.preventDefault();
    console.warn('[MYSC] Vite preload error suppressed (no auto-reload):', customEvent.detail);
  });
}

installVitePreloadRecovery();
initObservability(import.meta.env);
installGlobalObservabilityHandlers();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[MYSC] service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
  
