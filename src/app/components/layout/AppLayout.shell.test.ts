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
});

describe('AppLayout root entry contract', () => {
  it('renders the root feature search without sidebar chrome', () => {
    expect(source).toContain("if (location.pathname === '/')");
    expect(source).toContain('<main className="min-h-dvh">');
    expect(source).toContain('<Outlet />');
  });
});
