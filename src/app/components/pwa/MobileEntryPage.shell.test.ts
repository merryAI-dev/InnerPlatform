import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'MobileEntryPage.tsx'), 'utf8');

describe('MobileEntryPage route contract', () => {
  it('renders mobile business cards in place without route-level redirects', () => {
    expect(source).toContain('shouldUseBusinessCardMobileEntry');
    expect(source).toContain('BusinessCardLabPage');
    expect(source).toContain("'/mobile-entry'");
    expect(source).toContain('return <BusinessCardLabPage />');
    expect(source).not.toContain('Navigate');
    expect(source).not.toContain('replace');
  });
});
