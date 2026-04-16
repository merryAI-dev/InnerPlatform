export interface PortalRouteBudget {
  routeId: string;
  pathname: string;
  maxFirestoreListenRequests: number;
  maxFirestoreWriteRequests: number;
  maxFirestoreListen400s: number;
  maxConsoleErrors: number;
}

export interface PortalRouteBudgetObservedMetrics {
  consoleErrors: number;
  firestoreListenRequests: number;
  firestoreWriteRequests: number;
  firestoreListen400s: number;
}

export interface PortalRouteBudgetEvaluation {
  passed: boolean;
  failures: Array<keyof PortalRouteBudgetObservedMetrics>;
}

function normalizePathname(pathname: string): string {
  const value = String(pathname || '').trim();
  if (!value) return '';
  const withoutQuery = value.split('?')[0].split('#')[0];
  if (!withoutQuery) return '';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.replace(/\/+$/, '');
  }
  return withoutQuery;
}

function buildPortalRouteBudget(routeId: string, pathname: string): PortalRouteBudget {
  return {
    routeId,
    pathname,
    maxFirestoreListenRequests: 0,
    maxFirestoreWriteRequests: 0,
    maxFirestoreListen400s: 0,
    maxConsoleErrors: 0,
  };
}

function freezePortalRouteBudget(budget: PortalRouteBudget): PortalRouteBudget {
  return Object.freeze({ ...budget });
}

export const PORTAL_STABLE_ROUTE_BUDGETS: Readonly<Record<string, PortalRouteBudget>> = Object.freeze({
  'portal-dashboard': freezePortalRouteBudget(buildPortalRouteBudget('portal-dashboard', '/portal')),
  'portal-submissions': freezePortalRouteBudget(buildPortalRouteBudget('portal-submissions', '/portal/submissions')),
  'portal-weekly-expenses': freezePortalRouteBudget(buildPortalRouteBudget('portal-weekly-expenses', '/portal/weekly-expenses')),
  'portal-bank-statements': freezePortalRouteBudget(buildPortalRouteBudget('portal-bank-statements', '/portal/bank-statements')),
  'portal-payroll': freezePortalRouteBudget(buildPortalRouteBudget('portal-payroll', '/portal/payroll')),
});

const PORTAL_STABLE_ROUTE_BUDGET_LIST = Object.values(PORTAL_STABLE_ROUTE_BUDGETS);

export function classifyPortalRouteBudget(pathname: string): PortalRouteBudget | null {
  const normalized = normalizePathname(pathname);
  if (!normalized) return null;
  return PORTAL_STABLE_ROUTE_BUDGET_LIST.find((budget) => budget.pathname === normalized) || null;
}

function normalizeObservedCount(value: unknown): { value: number; invalid: boolean } {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
    return { value: Number.POSITIVE_INFINITY, invalid: true };
  }
  return { value: count, invalid: false };
}

export function evaluatePortalRouteBudget(
  budget: PortalRouteBudget,
  observed: PortalRouteBudgetObservedMetrics,
): PortalRouteBudgetEvaluation {
  const failures: Array<keyof PortalRouteBudgetObservedMetrics> = [];
  const consoleErrors = normalizeObservedCount(observed.consoleErrors);
  const firestoreListenRequests = normalizeObservedCount(observed.firestoreListenRequests);
  const firestoreWriteRequests = normalizeObservedCount(observed.firestoreWriteRequests);
  const firestoreListen400s = normalizeObservedCount(observed.firestoreListen400s);

  if (consoleErrors.invalid || consoleErrors.value > budget.maxConsoleErrors) failures.push('consoleErrors');
  if (firestoreListenRequests.invalid || firestoreListenRequests.value > budget.maxFirestoreListenRequests) failures.push('firestoreListenRequests');
  if (firestoreWriteRequests.invalid || firestoreWriteRequests.value > budget.maxFirestoreWriteRequests) failures.push('firestoreWriteRequests');
  if (firestoreListen400s.invalid || firestoreListen400s.value > budget.maxFirestoreListen400s) failures.push('firestoreListen400s');

  return {
    passed: failures.length === 0,
    failures,
  };
}
