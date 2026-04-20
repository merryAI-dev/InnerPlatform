import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const markSheetSourceAppliedStart = portalStoreSource.indexOf(
  'const markSheetSourceApplied = useCallback(async (input: {',
);
const saveExpenseSheetRowsStart = markSheetSourceAppliedStart >= 0
  ? portalStoreSource.indexOf('const saveExpenseSheetRows = useCallback(async (rows: ImportRow[]) => {', markSheetSourceAppliedStart)
  : -1;
const markSheetSourceAppliedSource = markSheetSourceAppliedStart >= 0 && saveExpenseSheetRowsStart > markSheetSourceAppliedStart
  ? portalStoreSource.slice(markSheetSourceAppliedStart, saveExpenseSheetRowsStart)
  : '';
const platformBranchStart = markSheetSourceAppliedSource.indexOf('if (isPlatformApiEnabled() && !isDevHarnessUser) {');
const fallbackBranchStart = markSheetSourceAppliedSource.indexOf('await setDoc(', platformBranchStart);
const platformBranchSource = platformBranchStart >= 0 && fallbackBranchStart > platformBranchStart
  ? markSheetSourceAppliedSource.slice(platformBranchStart, fallbackBranchStart)
  : '';

describe('portal sheet source apply command boundary', () => {
  it('routes platform-mode sheet source apply through the portal command and preserves the Firestore fallback', () => {
    expect(portalStoreSource).toContain('savePortalSheetSourceAppliedViaBff');
    expect(portalStoreSource).toContain('/api/v1/portal/sheet-source/apply');
    expect(platformBranchSource).toContain('if (!authUser) {');
    expect(platformBranchSource).toContain("throw new Error('Platform API requires an authenticated actor for sheet source apply.');");
    expect(platformBranchSource).not.toContain('updatedAt: now');
    expect(platformBranchSource).not.toContain('updatedBy: portalUser?.name || authUser?.name ||');
    expect(markSheetSourceAppliedSource).toContain('await setDoc(');
  });
});
