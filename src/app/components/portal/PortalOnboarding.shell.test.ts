import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalOnboarding.tsx'), 'utf8');

describe('PortalOnboarding redirect contract', () => {
  it('keeps admin-space users in place instead of redirecting home', () => {
    expect(source).toContain('isAdminSpaceUser');
    expect(source).toContain('포털 접근 권한을 확인해 주세요');
    expect(source).not.toContain("navigate('/', { replace: true })");
  });
});
