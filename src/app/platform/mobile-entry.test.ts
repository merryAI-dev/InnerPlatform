import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CARD_MOBILE_ENTRY_PATH,
  MOBILE_ENTRY_PATH,
  isMobileUserAgent,
  isMobileViewport,
  shouldUseBusinessCardMobileEntry,
} from './mobile-entry';

describe('mobile-entry', () => {
  it('uses business cards as the mobile default entry', () => {
    expect(BUSINESS_CARD_MOBILE_ENTRY_PATH).toBe('/business-cards');
    expect(MOBILE_ENTRY_PATH).toBe('/mobile-entry');
    expect(shouldUseBusinessCardMobileEntry({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1',
      requestedPath: '/',
    })).toBe(true);
    expect(shouldUseBusinessCardMobileEntry({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36',
    })).toBe(true);
  });

  it('preserves explicit deep links on mobile', () => {
    expect(shouldUseBusinessCardMobileEntry({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148 Safari/604.1',
      requestedPath: '/portal/cashflow',
    })).toBe(false);
    expect(shouldUseBusinessCardMobileEntry({
      viewportWidth: 390,
      requestedPath: '/business-cards',
    })).toBe(false);
  });

  it('treats the dedicated mobile entry route as a default entry', () => {
    expect(shouldUseBusinessCardMobileEntry({
      viewportWidth: 390,
      requestedPath: '/mobile-entry',
    })).toBe(true);
  });

  it('falls back to viewport width when user agent is not specific', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe(false);
    expect(isMobileViewport(390)).toBe(true);
    expect(isMobileViewport(1024)).toBe(false);
    expect(shouldUseBusinessCardMobileEntry({ viewportWidth: 390, requestedPath: '/' })).toBe(true);
  });
});
