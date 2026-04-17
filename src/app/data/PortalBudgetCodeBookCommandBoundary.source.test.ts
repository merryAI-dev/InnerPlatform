import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const saveBudgetCodeBookStart = portalStoreSource.indexOf(
  'const saveBudgetCodeBook = useCallback(async (rows: BudgetCodeEntry[], renames: BudgetCodeRename[] = []) => {',
);
const createProjectRequestStart = saveBudgetCodeBookStart >= 0
  ? portalStoreSource.indexOf('const createProjectRequest = useCallback(async (payload: ProjectRequestPayload): Promise<string | null> => {', saveBudgetCodeBookStart)
  : -1;
const saveBudgetCodeBookSource = saveBudgetCodeBookStart >= 0 && createProjectRequestStart > saveBudgetCodeBookStart
  ? portalStoreSource.slice(saveBudgetCodeBookStart, createProjectRequestStart)
  : '';
const platformBranchStart = saveBudgetCodeBookSource.indexOf('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
const fallbackBranchStart = saveBudgetCodeBookSource.indexOf('if (isDevHarnessUser || !db) {', platformBranchStart);
const platformBranchSource = platformBranchStart >= 0 && fallbackBranchStart > platformBranchStart
  ? saveBudgetCodeBookSource.slice(platformBranchStart, fallbackBranchStart)
  : '';
const fallbackBranchSource = fallbackBranchStart >= 0
  ? saveBudgetCodeBookSource.slice(fallbackBranchStart)
  : '';

describe('portal budget code book command boundary', () => {
  it('routes platform-mode budget code book saves through the portal command and leaves the Firestore fallback unchanged', () => {
    expect(portalStoreSource).toContain('savePortalBudgetCodeBookViaBff');
    expect(portalStoreSource).toContain('/api/v1/portal/budget/code-book/save');
    expect(platformBranchSource).toContain('if (!authUser) {');
    expect(platformBranchSource).toContain("throw new Error('Platform API requires an authenticated actor for budget code book updates.');");
    expect(platformBranchSource).toContain('renames: [...renames],');
    expect(platformBranchSource).not.toContain('renameMap');
    expect(platformBranchSource).not.toContain('updatedAt: now');
    expect(platformBranchSource).not.toContain('updatedBy: portalUser?.name || authUser?.name ||');
    expect(saveBudgetCodeBookSource).toContain('await setDoc(');
    expect(fallbackBranchSource).toContain('const renameMap = new Map<string, { code: string; sub: string }>();');
    expect(fallbackBranchSource).toContain('if (renameMap.size === 0) return;');
  });
});
