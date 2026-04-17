import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const saveBudgetPlanRowsStart = portalStoreSource.indexOf(
  'const saveBudgetPlanRows = useCallback(async (rows: BudgetPlanRow[]) => {',
);
const saveBudgetCodeBookStart = saveBudgetPlanRowsStart >= 0
  ? portalStoreSource.indexOf('const saveBudgetCodeBook = useCallback(async (rows: BudgetCodeEntry[], renames: BudgetCodeRename[] = []) => {', saveBudgetPlanRowsStart)
  : -1;
const saveBudgetPlanRowsSource = saveBudgetPlanRowsStart >= 0 && saveBudgetCodeBookStart > saveBudgetPlanRowsStart
  ? portalStoreSource.slice(saveBudgetPlanRowsStart, saveBudgetCodeBookStart)
  : '';
const platformBranchStart = saveBudgetPlanRowsSource.indexOf('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
const fallbackBranchStart = saveBudgetPlanRowsSource.indexOf('const payload = withTenantScope(orgId, {', platformBranchStart);
const platformBranchSource = platformBranchStart >= 0 && fallbackBranchStart > platformBranchStart
  ? saveBudgetPlanRowsSource.slice(platformBranchStart, fallbackBranchStart)
  : '';

describe('portal budget plan command boundary', () => {
  it('routes platform-mode budget plan saves through the portal command and leaves the Firestore fallback unchanged', () => {
    expect(portalStoreSource).toContain('savePortalBudgetPlanViaBff');
    expect(portalStoreSource).toContain('/api/v1/portal/budget/plan/save');
    expect(platformBranchSource).toContain('if (!authUser) {');
    expect(platformBranchSource).toContain("throw new Error('Platform API requires an authenticated actor for budget plan saves.');");
    expect(platformBranchSource).not.toContain('updatedAt: now');
    expect(platformBranchSource).not.toContain('updatedBy: portalUser?.name || authUser?.name ||');
    expect(saveBudgetPlanRowsSource).toContain('await setDoc(');
    expect(saveBudgetPlanRowsSource).toContain('if (isDevHarnessUser || !db || !currentProjectId) {');
  });
});
