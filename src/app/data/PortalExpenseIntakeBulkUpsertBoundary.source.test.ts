import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, 'portal-store.tsx'), 'utf8');
const upsertExpenseIntakeItemsStart = portalStoreSource.indexOf(
  'const upsertExpenseIntakeItems = useCallback(async (items: BankImportIntakeItem[]) => {',
);
const saveExpenseIntakeDraftStart = upsertExpenseIntakeItemsStart >= 0
  ? portalStoreSource.indexOf('const saveExpenseIntakeDraft = useCallback(async (id: string, updates: Partial<BankImportIntakeItem>) => {', upsertExpenseIntakeItemsStart)
  : -1;
const upsertExpenseIntakeItemsSource = upsertExpenseIntakeItemsStart >= 0 && saveExpenseIntakeDraftStart > upsertExpenseIntakeItemsStart
  ? portalStoreSource.slice(upsertExpenseIntakeItemsStart, saveExpenseIntakeDraftStart)
  : '';

describe('portal expense intake bulk upsert command boundary', () => {
  it('routes platform bulk upserts through the dedicated BFF command while keeping the dev harness merge path', () => {
    expect(upsertExpenseIntakeItemsSource).toContain('if (isDevHarnessUser || !db || !currentProjectId) {');
    expect(upsertExpenseIntakeItemsSource).toContain('if (isPlatformApiEnabled()) {');
    expect(upsertExpenseIntakeItemsSource).toContain('if (!authUser) return;');
    expect(upsertExpenseIntakeItemsSource).toContain('savePortalExpenseIntakeBulkUpsertViaBff');
    expect(portalStoreSource).toContain('}, [authUser, currentProjectId, db, isDevHarnessUser, orgId]);');
  });

  it('preserves the direct firestore fallback for non-platform bulk upserts', () => {
    expect(upsertExpenseIntakeItemsSource).toContain("await Promise.all(");
    expect(upsertExpenseIntakeItemsSource).toContain("doc(db, `${getOrgDocumentPath(orgId, 'projects', currentProjectId)}/expense_intake/${item.id}`)");
    expect(upsertExpenseIntakeItemsSource).toContain('setExpenseIntakeItems(() => {');
  });
});
