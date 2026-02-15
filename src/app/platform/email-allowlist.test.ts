import { describe, expect, it } from 'vitest';
import { formatAllowedDomains, isAllowedEmail, parseAllowedEmailDomains } from './email-allowlist';

describe('email allowlist', () => {
  it('parses domains from csv', () => {
    expect(parseAllowedEmailDomains('mysc.co.kr, example.com')).toEqual(['mysc.co.kr', 'example.com']);
  });

  it('normalizes leading @ and casing', () => {
    expect(parseAllowedEmailDomains('@MYSC.CO.KR')).toEqual(['mysc.co.kr']);
  });

  it('falls back when empty', () => {
    expect(parseAllowedEmailDomains('', ['a.com'])).toEqual(['a.com']);
  });

  it('checks allowed emails', () => {
    expect(isAllowedEmail('user@mysc.co.kr', ['mysc.co.kr'])).toBe(true);
    expect(isAllowedEmail('user@other.com', ['mysc.co.kr'])).toBe(false);
    expect(isAllowedEmail('not-an-email', ['mysc.co.kr'])).toBe(false);
  });

  it('formats domains', () => {
    expect(formatAllowedDomains(['mysc.co.kr', '@example.com'])).toBe('@mysc.co.kr, @example.com');
  });
});

