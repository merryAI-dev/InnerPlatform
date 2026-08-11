import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'CashflowPage.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');

describe('Cashflow entry routes', () => {
  it('opens weekly history and replaces the old export page with management planning', () => {
    expect(pageSource).toContain('<CashflowWeeklyPage />');
    expect(pageSource).not.toContain('CashflowMonitorPage');
    expect(routesSource).toContain("{ path: 'cashflow/export', element: <S C={CashflowManagementPlanningPage} /> }");
  });
});
