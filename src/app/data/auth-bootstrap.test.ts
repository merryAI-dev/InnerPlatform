import { describe, expect, it } from 'vitest';
import { isBootstrapAdminEmail, parseBootstrapAdminEmails } from './auth-bootstrap';

describe('auth bootstrap admins', () => {
  it('includes default bootstrap admins even when env is empty', () => {
    const emails = parseBootstrapAdminEmails({});
    expect(emails).toContain('admin@mysc.co.kr');
    expect(emails).toContain('ai@mysc.co.kr');
    expect(emails).toContain('mwbyun1220@mysc.co.kr');
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
    expect(isBootstrapAdminEmail('AI@MYSC.CO.KR', {})).toBe(true);
    expect(isBootstrapAdminEmail('mwbyun1220@mysc.co.kr', {})).toBe(true);
    expect(isBootstrapAdminEmail('nobody@mysc.co.kr', {})).toBe(false);
  });
});
