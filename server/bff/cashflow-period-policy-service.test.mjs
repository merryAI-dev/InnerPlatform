import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routePath = new URL('./routes/cashflow-period-policy.mjs', import.meta.url);
const servicePath = new URL('./cashflow-period-policy-service.mjs', import.meta.url);
const sectionsPath = new URL('../../src/app/components/cashflow/CashflowPeriodPolicySections.tsx', import.meta.url);

describe('cashflow period policy architecture', () => {
  it('keeps Firestore, transaction, audit, and domain-plan orchestration out of the HTTP route', () => {
    expect(existsSync(servicePath)).toBe(true);
    const routeSource = readFileSync(routePath, 'utf8');

    expect(routeSource).toContain('createCashflowPeriodPolicyService');
    expect(routeSource).not.toMatch(/\bdb\.(?:collection|doc|runTransaction)\b/);
    expect(routeSource).not.toContain('buildCumulativeCloseHeadPlan');
    expect(routeSource).not.toContain('buildCumulativeCloseResetToReclosePlan');
    expect(routeSource).not.toContain('auditChainService.appendManyInTransaction');
  });

  it('renders only the semantic tone supplied by the BFF read model', () => {
    const sectionsSource = readFileSync(sectionsPath, 'utf8');

    expect(sectionsSource).not.toContain('GREEN_STATUSES');
    expect(sectionsSource).not.toContain('RED_STATUSES');
    expect(sectionsSource).not.toContain('statusTone(');
    expect(sectionsSource).toContain('tone: CashflowPeriodPolicyTone');
  });
});
