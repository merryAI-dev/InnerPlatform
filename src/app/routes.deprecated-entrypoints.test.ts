import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routesSource = readFileSync(resolve(import.meta.dirname, 'routes.tsx'), 'utf8');

describe('deprecated route entry points', () => {
  it('does not lazy-load deprecated PM/admin pages', () => {
    expect(routesSource).not.toContain('ExpenseManagementPage');
    expect(routesSource).not.toContain('PortalWeeklyExpensePage');
    expect(routesSource).not.toContain('PortalBankStatementPage');
    expect(routesSource).not.toContain('PortalPayrollPage');
  });

  it('keeps direct deprecated URLs safe by rendering NotFound', () => {
    expect(routesSource).toContain("{ path: 'expense-management', element: <S C={NotFoundPage} /> }");
    expect(routesSource).toContain("{ path: 'weekly-expenses', element: <S C={NotFoundPage} /> }");
    expect(routesSource).toContain("{ path: 'bank-statements', element: <S C={NotFoundPage} /> }");
    expect(routesSource).toContain("{ path: 'payroll', element: <S C={NotFoundPage} /> }");
  });
});
