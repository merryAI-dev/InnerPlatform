import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const syncExpenseIntakeEvidenceStart = portalStoreSource.indexOf(
  'const syncExpenseIntakeEvidence = useCallback(async (id: string, updates: Partial<BankImportIntakeItem>) => {',
);
const persistTransactionStart = syncExpenseIntakeEvidenceStart >= 0
  ? portalStoreSource.indexOf('const persistTransaction = useCallback(async (txData: Transaction) => {', syncExpenseIntakeEvidenceStart)
  : -1;
const syncExpenseIntakeEvidenceSource = syncExpenseIntakeEvidenceStart >= 0 && persistTransactionStart > syncExpenseIntakeEvidenceStart
  ? portalStoreSource.slice(syncExpenseIntakeEvidenceStart, persistTransactionStart)
  : '';

describe('portal expense intake evidence sync command boundary', () => {
  it('routes platform evidence sync saves through the dedicated BFF command', () => {
    expect(syncExpenseIntakeEvidenceSource).toContain('if (isPlatformApiEnabled()) {');
    expect(syncExpenseIntakeEvidenceSource).toContain('if (!authUser) {');
    expect(syncExpenseIntakeEvidenceSource).toContain('const result = await savePortalExpenseIntakeEvidenceSyncViaBff({');
    expect(syncExpenseIntakeEvidenceSource).not.toContain('savePortalExpenseIntakeProjectViaBff');
  });

  it('preserves the direct firestore fallback for non-platform evidence sync saves', () => {
    expect(syncExpenseIntakeEvidenceSource).toContain("doc(db, `${getOrgDocumentPath(orgId, 'projects', currentProjectId)}/expense_intake/${id}`)");
    expect(syncExpenseIntakeEvidenceSource).toContain("doc(db, `${getOrgDocumentPath(orgId, 'projects', currentProjectId)}/expense_sheets/${targetSheetId}`)");
  });
});
