import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AppLayout.tsx'), 'utf8');

describe('AppLayout participation alert contract', () => {
  it('keeps global participation alerts on formal participation rows only', () => {
    const alertBlock = source.slice(
      source.indexOf('const participationDangerCount'),
      source.indexOf('const totalAlerts'),
    );

    expect(alertBlock).toContain("entry.source !== 'PROJECT_TEAM_SYNC'");
    expect(alertBlock).not.toContain('buildAllProjectTeamParticipationEntries');
  });
});

describe('AppLayout LAB shell contract', () => {
  it('filters admin navigation through LAB visibility and exposes a LAB toggle', () => {
    expect(source).toContain('shouldShowShellRoute');
    expect(source).toContain('readShellLabEnabled');
    expect(source).toContain('writeShellLabEnabled');
    expect(source).toContain('LAB');
    expect(source).toContain('LAB 메뉴 보이기');
    expect(source).toContain("'admin', 'nav'");
  });

  it('keeps the user portal switch next to the realtime status instead of inside LAB navigation', () => {
    expect(source).toContain('function openPortalWorkspace()');
    expect(source).toContain("setWorkspacePreference('portal'");
    expect(source).toContain("navigate('/portal/project-select')");
    expect(source).toContain('로그아웃 없이 사용자 포털로 이동');
    expect(source).toContain('사용자 포털');
  });
});

describe('AppLayout root entry contract', () => {
  it('renders the root feature search without sidebar chrome', () => {
    expect(source).toContain("if (location.pathname === '/')");
    expect(source).toContain('<main className="min-h-dvh">');
    expect(source).toContain('<Outlet />');
  });

  it('keeps permission or workspace loss in-place instead of redirecting home', () => {
    expect(source).toContain('blockedAdminPath');
    expect(source).not.toContain("navigate('/portal/project-select', { replace: true })");
    expect(source).not.toContain('navigate(resolveHomePath(role, activeWorkspace), { replace: true })');
  });
});
