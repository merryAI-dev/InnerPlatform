import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalPersonnel.tsx'), 'utf8');

describe('PortalPersonnel shell contract', () => {
  it('keeps memo hooks before conditional returns', () => {
    const myEntriesIndex = source.indexOf('const myEntries = useMemo');
    const membersIndex = source.indexOf('const members = useMemo');

    expect(myEntriesIndex).toBeGreaterThan(0);
    expect(membersIndex).toBeGreaterThan(myEntriesIndex);
    expect(myEntriesIndex).toBeLessThan(source.indexOf('if (isLoading)'));
    expect(membersIndex).toBeLessThan(source.indexOf('if (isLoading)'));
    expect(membersIndex).toBeLessThan(source.indexOf('if (!myProject)'));
  });

  it('uses project team participation rows and the participation-rate term', () => {
    expect(source).toContain('buildProjectTeamParticipationEntries(myProject, participationEntries)');
    expect(source).toContain('평균 참여율');
    expect(source).toContain('참여율 {m.totalRate}%');
    expect(source).not.toContain('평균 투입율');
    expect(source).not.toContain('투입율 {m.totalRate}%');
  });
});
