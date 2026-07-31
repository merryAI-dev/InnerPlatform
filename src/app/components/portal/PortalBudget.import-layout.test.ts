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
const codeBookSurface = portalBudgetSource.slice(portalBudgetSource.indexOf('<Dialog open={codeBookMode}'));

describe('PortalBudget manual editing surface contract', () => {
  it('keeps manual editing while hiding budget import entry points', () => {
    expect(portalBudgetSource).toContain('title="예산 편집"');
    expect(portalBudgetSource).not.toContain('setBudgetImportOpen(true)');
    expect(portalBudgetSource).toContain('setEditMode(true)');
    expect(portalBudgetSource).toContain('setCodeBookMode(true)');
    expect(portalBudgetSource).toContain('onClick={saveSettings}');
    expect(codeBookSurface).not.toContain('<TabsTrigger value="paste"');
    expect(codeBookSurface).not.toContain('<TabsTrigger value="csv"');
    expect(portalLayoutSource).toContain("{ to: '/portal/budget', icon: BarChart3, label: '예산총괄' }");
    expect(routesSource).toContain("{ path: 'budget', element: <S C={PortalBudget} /> }");
    expect(portalBudgetSource).toContain('최종 수정예산');
    expect(portalBudgetSource).not.toContain('>수정 예산<');
    expect(portalBudgetSource).toContain('formatBudgetContractPeriod(myProject.contractStart, myProject.contractEnd)');
    expect(portalBudgetSource).toContain("return '계약기간 미등록'");
    expect(portalBudgetSource).not.toContain('badge={`${meta.year}년`}');
    expect(portalBudgetSource).not.toContain('fmtPercent(r.ratio)');
    expect(portalBudgetSource).not.toContain('fmtPercent(group.burnRate)');
    expect(portalBudgetSource).not.toContain('fmtPercent(subItem.burnRate)');
    expect(portalBudgetSource).not.toContain('fmtPercent(leaf.burnRate)');
  });

  it('keeps the adjacent admin summary editing description', () => {
    expect(adminBudgetSource).toContain('예산 편집 / 비목·세목 수정');
  });
});
