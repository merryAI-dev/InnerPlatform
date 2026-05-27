import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalLayoutSource = readFileSync(
  resolve(import.meta.dirname, 'PortalLayout.tsx'),
  'utf8',
);

describe('PortalLayout shell actions', () => {
  it('keeps payroll entry visible in the primary portal navigation', () => {
    expect(portalLayoutSource).toContain("to: '/portal/payroll'");
    expect(portalLayoutSource).toContain("label: '인건비/공지'");
    expect(portalLayoutSource).not.toContain("label: '인건비/공지', accent: true, hidden: true");
  });

  it('turns the top search into a project switcher', () => {
    expect(portalLayoutSource).toContain('CommandDialog');
    expect(portalLayoutSource).toContain('setCommandOpen(true)');
    expect(portalLayoutSource).toContain('title="열기"');
    expect(portalLayoutSource).toContain('검색 또는 열기');
    expect(portalLayoutSource).toContain('업무 바로가기');
    expect(portalLayoutSource).toContain('프로젝트 전환');
    expect(portalLayoutSource).toContain('관리');
    expect(portalLayoutSource).toContain('일치하는 프로젝트가 없습니다.');
    expect(portalLayoutSource).toContain('data-testid="portal-project-switch-trigger"');
    expect(portalLayoutSource).toContain("item.kind === 'portal'");
    expect(portalLayoutSource).toContain("item.kind === 'project'");
    expect(portalLayoutSource).not.toContain('포털 빠른 이동');
    expect(portalLayoutSource).not.toContain('빠른 이동, 담당 사업, 화면 검색');
    expect(portalLayoutSource).not.toContain('담당 사업 검색 또는 전환');
    expect(portalLayoutSource).not.toContain('if (!changed) return;');
  });

  it('uses the shared LAB visibility policy for portal shell items', () => {
    expect(portalLayoutSource).toContain('shouldShowShellRoute');
    expect(portalLayoutSource).toContain('labEnabled');
    expect(portalLayoutSource).toContain('LAB');
    expect(portalLayoutSource).toContain('LAB 메뉴 보이기');
    expect(portalLayoutSource).toContain('포털 메뉴 열기');
    expect(portalLayoutSource).not.toContain("item.to === '/portal/bank-statements' && currentFundInputMode === 'DIRECT_ENTRY'");
  });

  it('wires a user menu with profile, admin access, and logout', () => {
    expect(portalLayoutSource).toContain('내 프로필');
    expect(portalLayoutSource).toContain('로그아웃');
    expect(portalLayoutSource).toContain('관리자 공간');
    expect(portalLayoutSource).toContain('DropdownMenu');
  });

  it('uses a compact MYSC logo without extra workspace subtitle copy', () => {
    expect(portalLayoutSource).toContain('MyscWordmark');
    expect(portalLayoutSource).not.toContain('MYSC Workspace');
    expect(portalLayoutSource).not.toContain('Project Operations');
    expect(portalLayoutSource).not.toContain('My Work');
  });

  it('drops a separate submissions tab once submission status is absorbed into the dashboard', () => {
    expect(portalLayoutSource).not.toContain("/portal/submissions");
  });

  it('keeps onboarding bypass routes aligned with navigation policy', () => {
    expect(portalLayoutSource).toContain('isPortalStandaloneEntryPath');
    expect(portalLayoutSource).toContain("navigate('/portal/project-select')");
    expect(portalLayoutSource).toContain("navigate('/portal/weekly-expenses')");
    expect(portalLayoutSource).toContain("navigate('/portal/register-project')");
  });

  it('exposes stable portal navigation test ids for release-gate flows', () => {
    expect(portalLayoutSource).toContain('function buildPortalNavTestId');
    expect(portalLayoutSource).toContain('data-testid={buildPortalNavTestId(item.to)}');
    expect(portalLayoutSource).toContain("portal-nav-${path");
  });

  it('uses a wider content canvas for the weekly expense work surface', () => {
    expect(portalLayoutSource).toContain("const useWidePortalCanvas = location.pathname === '/portal/weekly-expenses';");
    expect(portalLayoutSource).toContain("w-full max-w-none px-3 py-4 md:px-5 md:py-6 xl:px-8");
    expect(portalLayoutSource).toContain("mx-auto w-full max-w-[1480px] p-4 md:p-6");
  });
});
