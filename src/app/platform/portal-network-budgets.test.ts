import { describe, expect, it } from 'vitest';
import {
  PORTAL_STABLE_ROUTE_BUDGETS,
  classifyPortalRouteBudget,
  evaluatePortalRouteBudget,
} from './portal-network-budgets';

describe('classifyPortalRouteBudget', () => {
  it('maps stable portal routes to explicit budget entries', () => {
    expect(classifyPortalRouteBudget('/portal')).toMatchObject({
      routeId: 'portal-dashboard',
      pathname: '/portal',
      maxFirestoreListenRequests: 0,
    });
    expect(classifyPortalRouteBudget('/portal/submissions')).toMatchObject({
      routeId: 'portal-submissions',
      pathname: '/portal/submissions',
    });
    expect(classifyPortalRouteBudget('/portal/weekly-expenses')).toMatchObject({
      routeId: 'portal-weekly-expenses',
      pathname: '/portal/weekly-expenses',
    });
    expect(classifyPortalRouteBudget('/portal/bank-statements')).toMatchObject({
      routeId: 'portal-bank-statements',
      pathname: '/portal/bank-statements',
    });
    expect(classifyPortalRouteBudget('/portal/payroll')).toMatchObject({
      routeId: 'portal-payroll',
      pathname: '/portal/payroll',
    });
  });

  it('returns null for non-stable routes', () => {
    expect(classifyPortalRouteBudget('/portal/unknown')).toBeNull();
    expect(classifyPortalRouteBudget('/dashboard')).toBeNull();
  });
});

describe('evaluatePortalRouteBudget', () => {
  it('passes when observed network activity stays within the budget', () => {
    const budget = PORTAL_STABLE_ROUTE_BUDGETS['portal-weekly-expenses'];
    expect(evaluatePortalRouteBudget(budget, {
      consoleErrors: 0,
      firestoreListenRequests: 0,
      firestoreWriteRequests: 0,
      firestoreListen400s: 0,
    })).toMatchObject({
      passed: true,
      failures: [],
    });
  });

  it('fails when firestore listen count exceeds the route budget', () => {
    const budget = PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'];
    const outcome = evaluatePortalRouteBudget(budget, {
      consoleErrors: 0,
      firestoreListenRequests: 1,
      firestoreWriteRequests: 0,
      firestoreListen400s: 0,
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toContain('firestoreListenRequests');
  });

  it('fails when console errors exceed the route budget', () => {
    const budget = PORTAL_STABLE_ROUTE_BUDGETS['portal-payroll'];
    const outcome = evaluatePortalRouteBudget(budget, {
      consoleErrors: 1,
      firestoreListenRequests: 0,
      firestoreWriteRequests: 0,
      firestoreListen400s: 0,
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toContain('consoleErrors');
  });

  it('fails closed when observed metrics are invalid', () => {
    const budget = PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'];
    const outcome = evaluatePortalRouteBudget(budget, {
      consoleErrors: Number.NaN,
      firestoreListenRequests: -1,
      firestoreWriteRequests: Number.POSITIVE_INFINITY,
      firestoreListen400s: Number.NaN,
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.failures).toEqual(expect.arrayContaining([
      'consoleErrors',
      'firestoreListenRequests',
      'firestoreWriteRequests',
      'firestoreListen400s',
    ]));
  });
});

describe('PORTAL_STABLE_ROUTE_BUDGETS', () => {
  it('is effectively immutable to consumers', () => {
    expect(() => {
      PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'].maxConsoleErrors = 99;
    }).toThrow();
    expect(PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'].maxConsoleErrors).toBe(0);
    expect(Object.isFrozen(PORTAL_STABLE_ROUTE_BUDGETS)).toBe(true);
    expect(Object.isFrozen(PORTAL_STABLE_ROUTE_BUDGETS['portal-dashboard'])).toBe(true);
  });
});
