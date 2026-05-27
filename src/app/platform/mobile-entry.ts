export const BUSINESS_CARD_MOBILE_ENTRY_PATH = '/business-cards';
export const MOBILE_ENTRY_PATH = '/mobile-entry';

export interface MobileEntryContext {
  userAgent?: string;
  viewportWidth?: number;
  requestedPath?: string;
}

export function isMobileUserAgent(userAgent: unknown): boolean {
  const ua = typeof userAgent === 'string' ? userAgent.toLowerCase() : '';
  return /iphone|ipad|ipod|android|mobile/.test(ua);
}

export function isMobileViewport(width: unknown): boolean {
  return typeof width === 'number' && Number.isFinite(width) && width > 0 && width < 768;
}

export function shouldUseBusinessCardMobileEntry(input: MobileEntryContext = {}): boolean {
  const requestedPath = typeof input.requestedPath === 'string' ? input.requestedPath.trim() : '';
  if (requestedPath && requestedPath !== '/' && requestedPath !== MOBILE_ENTRY_PATH) return false;
  return isMobileUserAgent(input.userAgent) || isMobileViewport(input.viewportWidth);
}
