import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalBudgetSource = readFileSync(
  resolve(import.meta.dirname, 'PortalBudget.tsx'),
  'utf8',
);
const portalLayoutSource = readFileSync(resolve(import.meta.dirname, 'PortalLayout.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');
const adminBudgetSource = readFileSync(resolve(import.meta.dirname, '../budget/BudgetSummaryPage.tsx'), 'utf8');

describe('PortalBudget read-only surface contract', () => {
  it('keeps the budget summary route while removing every budget mutation opener', () => {
    expect(portalBudgetSource).toContain('title="예산총괄"');
    expect(portalBudgetSource).not.toContain('setBudgetImportOpen(true)');
    expect(portalBudgetSource).not.toContain('setEditMode(true)');
    expect(portalBudgetSource).not.toContain('setCodeBookMode(true)');
    expect(portalLayoutSource).toContain("{ to: '/portal/budget', icon: BarChart3, label: '예산총괄' }");
    expect(routesSource).toContain("{ path: 'budget', element: <S C={PortalBudget} /> }");
  });

  it('does not advertise budget editing from the adjacent admin summary', () => {
    expect(adminBudgetSource).not.toContain('예산 편집 / 비목·세목 수정');
    expect(adminBudgetSource).toContain('예산 배정·소진·잔액 조회');
  });
});
