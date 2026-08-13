import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ParticipationPage.tsx'), 'utf8');

describe('ParticipationPage server snapshot contract', () => {
  it('renders the BFF snapshot without client-side participation calculation', () => {
    expect(source).toContain('fetchParticipationDashboardViaBff');
    expect(source).toContain('snapshot.members.map');
    expect(source).toContain('member.months.map');
    expect(source).not.toContain('reduce(');
    expect(source).not.toContain('buildAllProjectTeamParticipationEntries');
    expect(source).not.toContain('getMonthlyParticipationRate');
    expect(source).not.toContain('computeMemberSummaries');
  });

  it('does not retain fixed settlement or cross-verification classifications', () => {
    expect(source).not.toContain('KOICA');
    expect(source).not.toContain('교차검증');
    expect(source).not.toContain('PARTICIPATION_RISK_RULESET');
  });
});
