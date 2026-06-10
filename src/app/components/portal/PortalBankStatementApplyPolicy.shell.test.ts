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

  it('auto-saves the bank statement baseline before the completion wizard opens', () => {
    const applySelectedBlock = sourceBetween(
      bankStatementPageSource,
      'const handleApplySelected = useCallback',
      'const updateWizardDraft = useCallback',
    );

    expect(applySelectedBlock).toContain('if (dirty)');
    expect(applySelectedBlock).toContain('await persistSheet({ silent: true })');
    expect(applySelectedBlock).toContain('setWizardRows(unappliedSelectedRows)');
    expect(applySelectedBlock).not.toContain('applyBankStatementRowsToExpenseSheet({ columns, rows: selectedRows })');
  });

  it('supports versioned temp drafts instead of ambiguous draft banners', () => {
    expect(bankStatementPageSource).toContain('wizardDraftVersions');
    expect(bankStatementPageSource).toContain('loadWizardDraftVersions');
    expect(bankStatementPageSource).toContain('handleSaveWizardDraft');
    expect(bankStatementPageSource).toContain('작성본 불러오기');
    expect(bankStatementPageSource).toContain('임시저장은 30일 동안 보관됩니다');
    expect(bankStatementPageSource).not.toContain('작성중초안있음');
  });

  it('inherits weekly expense category, subcategory, sub-subcategory, cashflow, and evidence fields', () => {
    expect(bankStatementPageSource).toContain("label: '세세목'");
    expect(bankStatementPageSource).toContain("column: '세세목'");
    expect(bankStatementPageSource).toContain("label: '매입부가세'");
    expect(bankStatementPageSource).toContain("column: '매입부가세'");
    expect(bankStatementPageSource).toContain('budgetTreeV2');
    expect(bankStatementPageSource).toContain('budgetCodeBook');
    expect(bankStatementPageSource).toContain('evidenceRequiredMap');
    expect(bankStatementPageSource).toContain('resolveEvidenceSuggestion');
  });

  it('keeps full bank amount by default and exposes VAT split only as an explicit wizard action', () => {
    expect(bankStatementPageSource).toContain('splitVatIncludedDraftAmount');
    expect(bankStatementPageSource).toContain('Math.round(total / 11)');
    expect(bankStatementPageSource).toContain('buildVatIncludedDraftSuggestion');
    expect(bankStatementPageSource).toContain('handleApplyVatSuggestion');
    expect(bankStatementPageSource).toContain('부가세 추정 적용');
    expect(bankStatementPageSource).toContain('expenseAmount: formatNumberDraft(signedAmount)');
    expect(bankStatementPageSource).toContain("vatIn: ''");
    expect(bankStatementPageSource).toContain('depositAmount: formatNumberDraft(signedAmount)');
    expect(bankStatementPageSource).toContain("vatRefund: ''");
  });

  it('treats cashflow line as a strict company policy key in the wizard', () => {
    expect(bankStatementPageSource).toContain('CASHFLOW_LINE_OPTIONS');
    expect(bankStatementPageSource).toContain('WIZARD_CASHFLOW_OPTIONS');
    expect(bankStatementPageSource).toContain("option.value !== 'INPUT_VAT_OUT'");
    expect(bankStatementPageSource).toContain("field.key === 'cashflowLine'");
    expect(bankStatementPageSource).toContain('cashflow항목은 회사 기준 Actual PK입니다');

    const cashflowFieldBlock = sourceBetween(
      bankStatementPageSource,
      "if (field.key === 'cashflowLine')",
      "if (field.key === 'budgetCategory')",
    );
    expect(cashflowFieldBlock).toContain('<select');
    expect(cashflowFieldBlock).toContain('WIZARD_CASHFLOW_OPTIONS.map');
    expect(cashflowFieldBlock).not.toContain('<input');
  });

  it('does not expose weekly week labels as manual wizard input', () => {
    const wizardFieldBlock = sourceBetween(
      bankStatementPageSource,
      'const WIZARD_FIELDS = [',
      '] as const;',
    );
    expect(wizardFieldBlock).not.toContain('해당 주차');
    expect(wizardFieldBlock).not.toContain('week');
    expect(bankStatementPageSource).toContain('해당 주차는 거래일 기준으로 자동 계산됩니다');
  });

  it('shows weekly week labels as read-only calculated wizard context', () => {
    expect(bankStatementPageSource).toContain('buildWizardWeekLabel');
    expect(bankStatementPageSource).toContain('getYearMondayWeeks');
    expect(bankStatementPageSource).toContain('findWeekForDate');
    expect(bankStatementPageSource).toContain('wizardImportMetaByRowKey');
    expect(bankStatementPageSource).toContain('수정불가 계산값');
    expect(bankStatementPageSource).toContain('aria-label="해당 주차 수정불가 계산값"');
  });

  it('uses a dense full-screen wizard layout with grouped deposit and withdrawal amount fields', () => {
    expect(bankStatementPageSource).toContain('w-[min(1680px,98vw)]');
    expect(bankStatementPageSource).toContain('max-h-[94vh]');
    expect(bankStatementPageSource).toContain('WIZARD_PRIMARY_FIELDS');
    expect(bankStatementPageSource).toContain('WIZARD_DEPOSIT_FIELDS');
    expect(bankStatementPageSource).toContain('WIZARD_WITHDRAWAL_FIELDS');
    expect(bankStatementPageSource).toContain('colSpan={WIZARD_DEPOSIT_FIELDS.length}');
    expect(bankStatementPageSource).toContain('colSpan={WIZARD_WITHDRAWAL_FIELDS.length}');
    expect(bankStatementPageSource).toContain('입금');
    expect(bankStatementPageSource).toContain('출금');
  });

  it('keeps user assistance inside temp state with explicit apply and undo controls', () => {
    expect(bankStatementPageSource).toContain('sameCounterpartySuggestions');
    expect(bankStatementPageSource).toContain('handleApplySuggestion');
    expect(bankStatementPageSource).toContain('handleBulkApplyWizardDraft');
    expect(bankStatementPageSource).toContain('handleWizardUndo');
    expect(bankStatementPageSource).toContain('wizardHistory');
    expect(bankStatementPageSource).toContain('오류 요약');
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
