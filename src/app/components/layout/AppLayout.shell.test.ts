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
