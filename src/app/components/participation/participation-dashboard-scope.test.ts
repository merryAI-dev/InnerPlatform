import { describe, expect, it } from 'vitest';
import { buildParticipationDashboardAuthScopeKey } from './participation-dashboard-scope';

describe('participation dashboard auth scope', () => {
  it('changes when tenant, actor, or role changes', () => {
    const base = buildParticipationDashboardAuthScopeKey('mysc', { uid: 'admin-1', role: 'admin' });

    expect(buildParticipationDashboardAuthScopeKey('org002', { uid: 'admin-1', role: 'admin' })).not.toBe(base);
    expect(buildParticipationDashboardAuthScopeKey('mysc', { uid: 'admin-2', role: 'admin' })).not.toBe(base);
    expect(buildParticipationDashboardAuthScopeKey('mysc', { uid: 'admin-1', role: 'viewer' })).not.toBe(base);
  });

  it('does not include a renewable token in the scope identity', () => {
    const before = { uid: 'admin-1', role: 'admin' as const, idToken: 'token-before' };
    const after = { ...before, idToken: 'token-after' };

    expect(buildParticipationDashboardAuthScopeKey('mysc', before))
      .toBe(buildParticipationDashboardAuthScopeKey('mysc', after));
  });
});
