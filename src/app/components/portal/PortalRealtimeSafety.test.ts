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
  it('uses fetch-based transaction loading on the portal dashboard', () => {
    expect(portalDashboardSource).toContain('getDocs(');
    expect(portalDashboardSource).not.toContain('onSnapshot(txQuery');
  });

  it('uses fetch-based transaction loading on the portal payroll page', () => {
    expect(portalPayrollSource).toContain('getDocs(');
    expect(portalPayrollSource).not.toContain('onSnapshot(txQuery');
  });
});
