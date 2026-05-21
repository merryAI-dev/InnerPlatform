import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_LAB_ROUTES,
  PORTAL_LAB_ROUTES,
  readShellLabEnabled,
  shouldShowShellRoute,
  writeShellLabEnabled,
} from './shell-lab-visibility';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shell LAB visibility', () => {
  it('hides direct bank statement surfaces for direct-entry portal projects', () => {
    expect(shouldShowShellRoute('/portal/bank-statements', 'portal', 'nav', {
      fundInputMode: 'DIRECT_ENTRY',
      labEnabled: false,
    })).toBe(false);
    expect(shouldShowShellRoute('/portal/bank-statements', 'portal', 'command', {
      fundInputMode: 'DIRECT_ENTRY',
      labEnabled: false,
    })).toBe(false);
    expect(shouldShowShellRoute('/portal/weekly-expenses', 'portal', 'nav', {
      fundInputMode: 'DIRECT_ENTRY',
      labEnabled: false,
    })).toBe(true);
  });

  it('keeps direct bank statements visible for non-direct portal projects', () => {
    expect(shouldShowShellRoute('/portal/bank-statements', 'portal', 'nav', {
      fundInputMode: 'BANK_STATEMENT',
      labEnabled: false,
    })).toBe(true);
  });

  it('hides admin LAB routes by default and reveals them when LAB is enabled', () => {
    expect(ADMIN_LAB_ROUTES).toEqual([
      '/board',
      '/evidence',
      '/bank-reconciliation',
      '/payroll',
      '/budget-summary',
      '/expense-management',
      '/participation',
      '/koica-personnel',
      '/personnel-changes',
      '/approvals',
      '/audit',
      '/hr-announcements',
      '/training',
      '/settings',
      '/portal',
    ]);

    for (const route of ADMIN_LAB_ROUTES) {
      expect(shouldShowShellRoute(route, 'admin', 'nav', { labEnabled: false })).toBe(false);
      expect(shouldShowShellRoute(route, 'admin', 'command', { labEnabled: true })).toBe(true);
    }
  });

  it('keeps core admin routes visible with LAB disabled', () => {
    expect(shouldShowShellRoute('/', 'admin', 'nav', { labEnabled: false })).toBe(true);
    expect(shouldShowShellRoute('/projects', 'admin', 'nav', { labEnabled: false })).toBe(true);
    expect(shouldShowShellRoute('/projects/migration-audit', 'admin', 'nav', { labEnabled: false })).toBe(true);
    expect(shouldShowShellRoute('/cashflow', 'admin', 'nav', { labEnabled: false })).toBe(true);
    expect(shouldShowShellRoute('/users', 'admin', 'nav', { labEnabled: false })).toBe(true);
  });

  it('hides portal LAB routes by default and reveals them when LAB is enabled', () => {
    expect(PORTAL_LAB_ROUTES).toEqual(['/portal/board']);
    expect(shouldShowShellRoute('/portal/board', 'portal', 'nav', { labEnabled: false })).toBe(false);
    expect(shouldShowShellRoute('/portal/board', 'portal', 'command', { labEnabled: true })).toBe(true);
  });

  it('passes unknown routes through because this is not a route guard', () => {
    expect(shouldShowShellRoute('/unknown-route', 'admin', 'nav', { labEnabled: false })).toBe(true);
  });

  it('persists LAB state with a safe default of off', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });

    expect(readShellLabEnabled()).toBe(false);

    writeShellLabEnabled(true);
    expect(readShellLabEnabled()).toBe(true);

    writeShellLabEnabled(false);
    expect(readShellLabEnabled()).toBe(false);
  });
});
