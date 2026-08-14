import { describe, expect, it } from 'vitest';
import { isBootstrapAdminEmail, parseBootstrapAdminEmails } from './auth-bootstrap';

describe('auth bootstrap admins', () => {
  it('keeps only the recovery owner as a default bootstrap admin', () => {
    const emails = parseBootstrapAdminEmails({});
    expect(emails).toEqual(['mwbyun1220@mysc.co.kr']);
  });

  it('merges and normalizes env bootstrap admin emails', () => {
    const emails = parseBootstrapAdminEmails({
      VITE_BOOTSTRAP_ADMIN_EMAILS: 'FOO@MYSC.CO.KR, bar@mysc.co.kr ,',
      VITE_BOOTSTRAP_ADMIN_EMAIL: 'baz@mysc.co.kr',
    });
    expect(emails).toContain('foo@mysc.co.kr');
    expect(emails).toContain('bar@mysc.co.kr');
    expect(emails).toContain('baz@mysc.co.kr');
  });

  it('checks bootstrap admin emails case-insensitively', () => {
    expect(isBootstrapAdminEmail('MWBYUN1220@MYSC.CO.KR', {})).toBe(true);
    expect(isBootstrapAdminEmail('AI@MYSC.CO.KR', {})).toBe(false);
    expect(isBootstrapAdminEmail('nobody@mysc.co.kr', {})).toBe(false);
  });
});
