import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'MobileEntryPage.tsx'), 'utf8');

describe('MobileEntryPage route contract', () => {
  it('sends mobile PWA launches to business cards and desktop launches to the existing root', () => {
    expect(source).toContain('shouldUseBusinessCardMobileEntry');
    expect(source).toContain('BUSINESS_CARD_MOBILE_ENTRY_PATH');
    expect(source).toContain("'/mobile-entry'");
    expect(source).toContain("to={useBusinessCardEntry ? BUSINESS_CARD_MOBILE_ENTRY_PATH : '/'}");
  });
});
