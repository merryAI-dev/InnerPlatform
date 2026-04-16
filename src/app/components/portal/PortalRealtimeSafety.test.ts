import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalDashboardSource = readFileSync(
  resolve(import.meta.dirname, 'PortalDashboard.tsx'),
  'utf8',
);

const portalPayrollSource = readFileSync(
  resolve(import.meta.dirname, 'PortalPayrollPage.tsx'),
  'utf8',
);

describe('portal realtime safety', () => {
  it('does not fan out raw transaction reads from the portal dashboard page', () => {
    expect(portalDashboardSource).not.toContain('firebase/firestore');
    expect(portalDashboardSource).not.toContain('collection(');
    expect(portalDashboardSource).not.toContain('getDocs(');
    expect(portalDashboardSource).not.toContain('query(');
    expect(portalDashboardSource).not.toContain('where(');
    expect(portalDashboardSource).not.toContain('onSnapshot(');
    expect(portalDashboardSource).toContain('transactions');
  });

  it('does not fan out raw transaction reads from the portal payroll page', () => {
    expect(portalPayrollSource).not.toContain('firebase/firestore');
    expect(portalPayrollSource).not.toContain('collection(');
    expect(portalPayrollSource).not.toContain('getDocs(');
    expect(portalPayrollSource).not.toContain('query(');
    expect(portalPayrollSource).not.toContain('where(');
    expect(portalPayrollSource).not.toContain('onSnapshot(');
    expect(portalPayrollSource).toContain('transactions');
  });
});
