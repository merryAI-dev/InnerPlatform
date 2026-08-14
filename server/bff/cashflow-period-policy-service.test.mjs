import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routePath = new URL('./routes/cashflow-period-policy.mjs', import.meta.url);
const servicePath = new URL('./cashflow-period-policy-service.mjs', import.meta.url);
const portPath = new URL('./cashflow-period-policy-port.mjs', import.meta.url);
const adapterPath = new URL('./cashflow-period-policy-firestore-adapter.mjs', import.meta.url);
const sectionsPath = new URL('../../src/app/components/cashflow/CashflowPeriodPolicySections.tsx', import.meta.url);

describe('cashflow period policy architecture', () => {
  it('keeps Firestore, transaction, audit, and domain-plan orchestration out of the HTTP route', () => {
    expect(existsSync(servicePath)).toBe(true);
    const routeSource = readFileSync(routePath, 'utf8');

    expect(routeSource).toContain('service.readPolicy');
    expect(routeSource).not.toContain('createCashflowPeriodPolicyService');
    expect(routeSource).not.toMatch(/\bdb\.(?:collection|doc|runTransaction)\b/);
    expect(routeSource).not.toContain('buildCumulativeCloseHeadPlan');
    expect(routeSource).not.toContain('buildCumulativeCloseResetToReclosePlan');
    expect(routeSource).not.toContain('auditChainService.appendManyInTransaction');
  });

  it('keeps the application service behind an owned persistence port and Firestore in its adapter', () => {
    expect(existsSync(portPath)).toBe(true);
    expect(existsSync(adapterPath)).toBe(true);
    const serviceSource = readFileSync(servicePath, 'utf8');
    const portSource = readFileSync(portPath, 'utf8');
    const adapterSource = readFileSync(adapterPath, 'utf8');

    expect(serviceSource).toContain('persistencePort');
    expect(serviceSource).not.toMatch(/\bdb\.(?:collection|doc|runTransaction)\b/);
    expect(serviceSource).not.toContain('assertLinkedActivePeopleUid');
    expect(portSource).toContain('assertCashflowPeriodPolicyPersistencePort');
    expect(adapterSource).toContain('createCashflowPeriodPolicyFirestoreAdapter');
    expect(adapterSource).toMatch(/\bdb\.(?:collection|doc|runTransaction)\b/);
  });

  it('renders only the semantic tone supplied by the BFF read model', () => {
    const sectionsSource = readFileSync(sectionsPath, 'utf8');

    expect(sectionsSource).not.toContain('GREEN_STATUSES');
    expect(sectionsSource).not.toContain('RED_STATUSES');
    expect(sectionsSource).not.toContain('statusTone(');
    expect(sectionsSource).toContain('tone: CashflowPeriodPolicyTone');
  });
});
