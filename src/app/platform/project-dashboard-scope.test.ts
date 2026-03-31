import { describe, expect, it } from 'vitest';
import {
  APPROVED_PROJECT_DASHBOARD_SCOPE,
  buildApprovedProjectDashboardSyncPlan,
  normalizeApprovedProjectName,
} from './project-dashboard-scope';

describe('project dashboard scope', () => {
  it('keeps the approved migration scope fixed at 25 unique projects', () => {
    const normalized = APPROVED_PROJECT_DASHBOARD_SCOPE.map((name) => normalizeApprovedProjectName(name));
    expect(APPROVED_PROJECT_DASHBOARD_SCOPE).toHaveLength(25);
    expect(new Set(normalized).size).toBe(25);
  });

  it('builds a sync plan that keeps only the approved ids', () => {
    const plan = buildApprovedProjectDashboardSyncPlan('mysc', [
      'approved-01',
      'approved-25',
      'legacy-01',
      'legacy-02',
    ], '2026-03-31T00:00:00.000Z');

    expect(plan.candidates).toHaveLength(25);
    expect(plan.keepIds[0]).toBe('approved-01');
    expect(plan.keepIds[24]).toBe('approved-25');
    expect(plan.deleteIds).toEqual(['legacy-01', 'legacy-02']);
    expect(plan.candidates[0]).toMatchObject({
      id: 'approved-01',
      tenantId: 'mysc',
      sourceRow: 1,
      businessName: APPROVED_PROJECT_DASHBOARD_SCOPE[0],
    });
  });
});
