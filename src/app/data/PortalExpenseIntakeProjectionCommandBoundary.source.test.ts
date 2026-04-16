import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const projectExpenseIntakeItemStart = portalStoreSource.indexOf(
  'const projectExpenseIntakeItem = useCallback(async (id: string, updates?: Partial<BankImportIntakeItem>) => {',
);
const syncExpenseIntakeEvidenceStart = portalStoreSource.indexOf(
  'const syncExpenseIntakeEvidence = useCallback(async (id: string, updates: Partial<BankImportIntakeItem>) => {',
);
const projectExpenseIntakeItemSource = projectExpenseIntakeItemStart >= 0 && syncExpenseIntakeEvidenceStart > projectExpenseIntakeItemStart
  ? portalStoreSource.slice(projectExpenseIntakeItemStart, syncExpenseIntakeEvidenceStart)
  : '';

describe('portal expense intake projection command boundary', () => {
  it('routes projected expense intake saves through the BFF command when platform api is enabled', () => {
    expect(projectExpenseIntakeItemSource).toContain('if (isPlatformApiEnabled() && authUser) {');
    expect(projectExpenseIntakeItemSource).toContain('const result = await savePortalExpenseIntakeProjectViaBff({');
  });

  it('preserves the direct firestore fallback for non-platform projection saves', () => {
    expect(projectExpenseIntakeItemSource).toContain("doc(db, `${getOrgDocumentPath(orgId, 'projects', currentProjectId)}/expense_sheets/${targetSheetId}`)");
    expect(projectExpenseIntakeItemSource).toContain("doc(db, `${getOrgDocumentPath(orgId, 'projects', currentProjectId)}/expense_intake/${id}`)");
  });
});
