
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { initObservability, installGlobalObservabilityHandlers } from './app/platform/observability';
import { installVitePreloadRecovery } from './app/platform/preload-recovery';
import './styles/index.css';

if (typeof window !== 'undefined') installVitePreloadRecovery();
initObservability(import.meta.env);
installGlobalObservabilityHandlers();

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error) => {
      console.warn('[MYSC] service worker registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
  
