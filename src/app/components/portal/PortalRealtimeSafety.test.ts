import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalPayrollSource = readFileSync(
  resolve(import.meta.dirname, 'PortalPayrollPage.tsx'),
  'utf8',
);

describe('portal realtime safety', () => {
  it('uses fetch-based transaction loading on the portal payroll page', () => {
    expect(portalPayrollSource).toContain('getDocs(');
    expect(portalPayrollSource).not.toContain('onSnapshot(txQuery');
  });
});
