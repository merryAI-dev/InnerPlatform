import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalLayoutSource = readFileSync(
  resolve(import.meta.dirname, 'PortalLayout.tsx'),
  'utf8',
);

describe('PortalLayout shell actions', () => {
  it('wires the search bar to a command dialog instead of static placeholder copy', () => {
    expect(portalLayoutSource).toContain('CommandDialog');
    expect(portalLayoutSource).toContain('setCommandOpen(true)');
    expect(portalLayoutSource).not.toContain('Search projects, submissions, budgets...');
  });

  it('wires a user menu with profile, admin access, and logout', () => {
    expect(portalLayoutSource).toContain('내 프로필');
    expect(portalLayoutSource).toContain('로그아웃');
    expect(portalLayoutSource).toContain('관리자 공간');
    expect(portalLayoutSource).toContain('DropdownMenu');
  });
});
