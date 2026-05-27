import { Navigate } from 'react-router';
import {
  BUSINESS_CARD_MOBILE_ENTRY_PATH,
  shouldUseBusinessCardMobileEntry,
} from '../../platform/mobile-entry';

export function MobileEntryPage() {
  const useBusinessCardEntry = shouldUseBusinessCardMobileEntry({
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
    requestedPath: typeof window !== 'undefined' ? window.location.pathname : '/mobile-entry',
  });

  return <Navigate to={useBusinessCardEntry ? BUSINESS_CARD_MOBILE_ENTRY_PATH : '/'} replace />;
}
