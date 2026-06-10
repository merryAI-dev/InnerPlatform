import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalStoreSource = readFileSync(resolve(import.meta.dirname, '../../data/portal-store.tsx'), 'utf8');
const bankStatementPageSource = readFileSync(resolve(import.meta.dirname, 'PortalBankStatementPage.tsx'), 'utf8');

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('portal bank statement apply policy', () => {
  it('keeps bank statement baseline save on the Java command path', () => {
    const saveBlock = sourceBetween(
      portalStoreSource,
      'const saveBankStatementRows = useCallback',
      'const applyBankStatementRowsToExpenseSheet = useCallback',
    );

    expect(saveBlock).toContain('importBankStatementBatchViaBff');
    expect(saveBlock).toContain('buildBankStatementServerImportLines');
    expect(saveBlock).not.toContain('saveExpenseSheetRows(');
    expect(saveBlock).not.toContain('mergeBankRowsIntoExpenseSheet(');
    expect(saveBlock).not.toContain('setDoc(');
  });

  it('hydrates bank statement baseline from the Java import-line read model when platform API is enabled', () => {
    expect(portalStoreSource).toContain('listBankStatementImportLinesViaBff');
    expect(portalStoreSource).toContain('bankStatementSheetFromImportLines');
    expect(portalStoreSource).toContain("status: 'staged'");
    expect(portalStoreSource).toContain('const weeklyPlatformApiEnabled = isPlatformApiEnabled();');
    expect(portalStoreSource).toContain('refreshBankStatementRowsFromServer().catch(handleBankStatementError)');
  });

  it('uses an explicit selected-row apply action for weekly expense handoff', () => {
    const applyBlock = sourceBetween(
      portalStoreSource,
      'const applyBankStatementRowsToExpenseSheet = useCallback',
      'const upsertExpenseIntakeItems = useCallback',
    );

    expect(portalStoreSource).toContain('applyBankStatementRowsToExpenseSheet');
    expect(applyBlock).toContain('importBankStatementBatchViaBff');
    expect(applyBlock).toContain('applyBankStatementItemsViaBff');
    expect(applyBlock).toContain('expectedSheetVersion: targetSheet?.sheetVersion');
    expect(applyBlock).toContain('cellPatchesByRowKey');
    expect(applyBlock).toContain('cellPatchesBySourceKey');
    expect(applyBlock).not.toContain('!line.duplicate');
    expect(applyBlock).not.toContain('saveExpenseSheetRows(');
    expect(applyBlock).not.toContain('mergeBankRowsIntoExpenseSheet(');
    expect(applyBlock).not.toContain('buildBankImportIntakeDoc(');
    expect(applyBlock).not.toContain('setDoc(');
    expect(bankStatementPageSource).toContain('선택 행 반영');
    expect(bankStatementPageSource).toContain('selectedRows');
    expect(bankStatementPageSource).toContain("switchStatusTab('applied')");
    expect(bankStatementPageSource).toContain("refreshBankStatementRows(status)");
    expect(bankStatementPageSource).toContain("activeStatusTab !== 'staged'");
    expect(bankStatementPageSource).not.toContain('applyBankStatementRowsToExpenseSheet({ columns, rows: selectedRows })');
  });

  it('opens a completion wizard before applying selected bank rows to weekly expense', () => {
    expect(bankStatementPageSource).toContain('data-testid="bank-statement-completion-wizard"');
    expect(bankStatementPageSource).toContain('비어있는 사업비 항목 작성');
    expect(bankStatementPageSource).toContain('wizardRows');
    expect(bankStatementPageSource).toContain('appliedBankLineIds');
    expect(bankStatementPageSource).toContain('unappliedSelectedRows');
    expect(bankStatementPageSource).toContain('handleSubmitWizard');
    expect(bankStatementPageSource).toContain('cellPatchesByRowKey');
    expect(bankStatementPageSource).toContain('applyBankStatementRowsToExpenseSheet({ columns, rows: wizardRows }');
  });

  it('computes already applied bank lines across every expense sheet tab', () => {
    expect(bankStatementPageSource).toContain('expenseSheets.flatMap');
    expect(bankStatementPageSource).toContain('collectAppliedBankLineIds(rowsAcrossSheets.length > 0 ? rowsAcrossSheets : expenseSheetRows)');
  });

  it('does not save the whole dirty bank baseline before confirming wizard patches', () => {
    const submitBlock = sourceBetween(
      bankStatementPageSource,
      'const handleSubmitWizard = useCallback',
      'const trustSurface = saving',
    );

    expect(submitBlock).toContain('buildWizardCellPatchesByRowKey');
    expect(submitBlock).toContain('applyBankStatementRowsToExpenseSheet({ columns, rows: wizardRows }');
    expect(submitBlock).not.toContain('saveBankStatementRows({ columns, rows })');
    expect(submitBlock).not.toContain('setDirty(false)');
  });

  it('keeps the bank statement wizard read-only after upload so frontend does not mutate source rows', () => {
    expect(bankStatementPageSource).toContain('data-testid="bank-statement-apply-wizard"');
    expect(bankStatementPageSource).not.toContain('행 추가');
    expect(bankStatementPageSource).not.toContain('행 삭제');
    expect(bankStatementPageSource).not.toContain('addRow');
    expect(bankStatementPageSource).not.toContain('removeRow');
    expect(bankStatementPageSource).not.toContain('updateCell');
    expect(bankStatementPageSource).not.toContain('handleCellBlur');
    expect(bankStatementPageSource).not.toContain('onBlur={(e) =>');
  });

  it('does not calculate bank statement monetary totals in the frontend wizard', () => {
    expect(bankStatementPageSource).not.toContain('parseNumber');
    expect(bankStatementPageSource).not.toContain('selectedAmountTotal');
    expect(bankStatementPageSource).not.toContain('totalAmount');
    expect(bankStatementPageSource).not.toContain('선택 합계');
    expect(bankStatementPageSource).not.toContain('합계 {');
  });
});
