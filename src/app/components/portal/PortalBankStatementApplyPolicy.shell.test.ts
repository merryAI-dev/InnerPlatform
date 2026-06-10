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
  it('keeps bank statement baseline save on the inherited Firestore document path', () => {
    const saveBlock = sourceBetween(
      portalStoreSource,
      'const saveBankStatementRows = useCallback',
      'const applyBankStatementRowsToExpenseSheet = useCallback',
    );

    expect(saveBlock).toContain('appendBankStatementRows');
    expect(saveBlock).toContain('bank_statements/default');
    expect(saveBlock).toContain('runTransaction');
    expect(saveBlock).toContain('transaction.get(bankStatementRef)');
    expect(saveBlock).toContain('transaction.set(bankStatementRef');
    expect(saveBlock).not.toContain('importBankStatementBatchViaBff');
    expect(saveBlock).not.toContain('buildBankStatementServerImportLines');
    expect(saveBlock).not.toContain('saveExpenseSheetRows(');
    expect(saveBlock).not.toContain('mergeBankRowsIntoExpenseSheet(');
  });

  it('hydrates bank statement baseline from Firestore even when the platform API is enabled', () => {
    expect(portalStoreSource).not.toContain('listBankStatementImportLinesViaBff');
    expect(portalStoreSource).not.toContain('bankStatementSheetFromImportLines');
    expect(portalStoreSource).not.toContain('const weeklyPlatformApiEnabled = isPlatformApiEnabled();');
    expect(portalStoreSource).not.toContain('refreshBankStatementRowsFromServer().catch(handleBankStatementError)');
    expect(portalStoreSource).toContain('bank_statements/default');
    expect(portalStoreSource).toContain('onSnapshot(bankStatementRef, handleBankStatementResult, handleBankStatementError)');
    expect(portalStoreSource).toContain('getDoc(bankStatementRef).then(handleBankStatementResult).catch(handleBankStatementError)');
  });

  it('uses an explicit selected-row apply action for weekly expense handoff', () => {
    const applyBlock = sourceBetween(
      portalStoreSource,
      'const applyBankStatementRowsToExpenseSheet = useCallback',
      'const upsertExpenseIntakeItems = useCallback',
    );

    expect(portalStoreSource).toContain('applyBankStatementRowsToExpenseSheet');
    expect(applyBlock).toContain('mapBankStatementsToImportRows');
    expect(applyBlock).toContain('mergeBankRowsIntoExpenseSheet');
    expect(applyBlock).toContain('buildExpenseSheetPersistenceDoc');
    expect(applyBlock).toContain('buildLedgerActualSyncPayload(preparedRows)');
    expect(applyBlock).toContain('buildCashflowWeekUpdatePatch');
    expect(applyBlock).toContain('buildInitialCashflowWeekDoc');
    expect(applyBlock).toContain("mode: 'actual'");
    expect(applyBlock).toContain('cashflowWeeks');
    expect(applyBlock).toContain('expense_sheets/${targetSheetId}');
    expect(applyBlock).toContain('runTransaction');
    expect(applyBlock).toContain('transaction.get(expenseSheetRef)');
    expect(applyBlock).toContain('normalizeExpenseSheetRows(data.rows)');
    expect(applyBlock).toContain('cellPatchesByRowKey');
    expect(applyBlock).toContain('bank-import-line:${rowKey}');
    expect(applyBlock).not.toContain('importBankStatementBatchViaBff');
    expect(applyBlock).not.toContain('applyBankStatementItemsViaBff');
    expect(applyBlock).not.toContain('readWeeklyExpenseSheetViaBff');
    expect(applyBlock).not.toContain('!line.duplicate');
    expect(applyBlock).not.toContain('saveExpenseSheetRows(');
    expect(applyBlock).not.toContain('buildBankImportIntakeDoc(');
    expect(bankStatementPageSource).toContain('선택 행 반영');
    expect(bankStatementPageSource).toContain('selectedRows');
    expect(bankStatementPageSource).toContain("switchStatusTab('applied')");
    expect(bankStatementPageSource).toContain("refreshBankStatementRows(status === 'all' ? undefined : status)");
    expect(bankStatementPageSource).toContain('visibleBankRows');
    expect(bankStatementPageSource).toContain("activeStatusTab === 'all'");
    expect(bankStatementPageSource).toContain("activeStatusTab === 'applied'");
    expect(bankStatementPageSource).toContain('appliedBankLineIds.has(rowKey)');
    expect(bankStatementPageSource).toContain("activeStatusTab !== 'staged'");
    expect(bankStatementPageSource).not.toContain('applyBankStatementRowsToExpenseSheet({ columns, rows: selectedRows })');
  });

  it('auto-hydrates cashflow actual read model from fixed weekly ledger rows', () => {
    expect(portalStoreSource).toContain('upsertLedgerActualReadModel');
    expect(portalStoreSource).toContain('ledgerActualReadModelHydrationKeyRef');
    expect(portalStoreSource).toContain('buildLedgerActualSyncPayload(ledgerRows)');
    expect(portalStoreSource).toContain('serializeLedgerActualSyncPayload(payload)');
    expect(portalStoreSource).toContain('areCashflowActualAmountsEqual');
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
    expect(bankStatementPageSource).toContain('localStorage');
    expect(bankStatementPageSource).toContain('WIZARD_DRAFT_STORAGE_PREFIX');
    expect(bankStatementPageSource).toContain('작성본 불러오기');
    expect(bankStatementPageSource).toContain('임시저장은 30일 동안 보관됩니다');
    expect(bankStatementPageSource).not.toContain('weekly_expense_apply_drafts');
    expect(bankStatementPageSource).not.toContain('getDocs(collection(db');
    expect(bankStatementPageSource).not.toContain('setDoc(draftRef');
    expect(bankStatementPageSource).not.toContain('작성중초안있음');
  });

  it('inherits weekly expense category, subcategory, sub-subcategory, and cashflow fields only', () => {
    expect(bankStatementPageSource).toContain("label: '지출구분'");
    expect(bankStatementPageSource).toContain("column: '지출구분'");
    expect(bankStatementPageSource).toContain('METHOD_OPTIONS');
    expect(bankStatementPageSource).toContain('METHOD_LABELS.TRANSFER');
    expect(bankStatementPageSource).toContain("label: '세세목'");
    expect(bankStatementPageSource).toContain("column: '세세목'");
    expect(bankStatementPageSource).toContain("label: '매입부가세'");
    expect(bankStatementPageSource).toContain("column: '매입부가세'");
    expect(bankStatementPageSource).toContain('budgetTreeV2');
    expect(bankStatementPageSource).toContain('budgetCodeBook');
    expect(bankStatementPageSource).not.toContain("key: 'evidenceRequired'");
    expect(bankStatementPageSource).not.toContain("label: '필수증빙자료 리스트'");
    expect(bankStatementPageSource).not.toContain("key: 'memo'");
    expect(bankStatementPageSource).not.toContain("label: '상세 적요'");
    expect(bankStatementPageSource).not.toContain("key: 'settlementNote'");
    expect(bankStatementPageSource).not.toContain("label: '비고'");
    expect(bankStatementPageSource).not.toContain('resolveEvidenceSuggestion');
  });

  it('keeps full bank amount by default and only applies VAT split through an explicit temp action', () => {
    expect(bankStatementPageSource).toContain('expenseAmount: formatNumberDraft(signedAmount)');
    expect(bankStatementPageSource).toContain("vatIn: ''");
    expect(bankStatementPageSource).toContain('depositAmount: formatNumberDraft(signedAmount)');
    expect(bankStatementPageSource).toContain("vatRefund: ''");
    expect(bankStatementPageSource).toContain('handleApplyVatSplit');
    expect(bankStatementPageSource).toContain('부가세 계산');
    expect(bankStatementPageSource).toContain("placeholder={vatField ? '(공급가액 정산만)' : field.label}");
    expect(bankStatementPageSource).toContain('border-red-400 bg-red-50');
    expect(bankStatementPageSource).not.toContain('부가세 추정 적용');
    expect(bankStatementPageSource).not.toContain('handleApplyVatSuggestion');
    expect(bankStatementPageSource).not.toContain('buildVatIncludedDraftSuggestion');
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

  it('keeps wizard policy copy behind hover help instead of always-visible sidebar comments', () => {
    expect(bankStatementPageSource).toContain('data-testid="bank-statement-wizard-policy-help"');
    expect(bankStatementPageSource).toContain('group-hover:translate-y-0');
    expect(bankStatementPageSource).toContain('group-hover:opacity-100');
    expect(bankStatementPageSource).not.toContain('<div className="border-b bg-slate-100 px-3 py-2 text-[12px] font-bold text-slate-900">\n                    작성 정책');
    expect(bankStatementPageSource).not.toContain('<p>cashflow항목은 회사 기준 Actual PK입니다. 목록에 없는 값은 직접 입력하지 않습니다.</p>');
    expect(bankStatementPageSource).not.toContain('<p>거래처 제안은 자동완성일 뿐 자동확정하지 않습니다.</p>');
    expect(bankStatementPageSource).not.toContain('<p>선택 행 일괄적용은 위자드 임시 입력값에만 적용합니다.</p>');
    expect(bankStatementPageSource).not.toContain('<p>확정 시 Java API가 행/셀 검증 후 사업비 입력에 반영합니다.</p>');
  });

  it('does not expose weekly week labels as manual wizard input', () => {
    const wizardFieldBlock = sourceBetween(
      bankStatementPageSource,
      'const WIZARD_FIELDS = [',
      '] as const;',
    );
    expect(wizardFieldBlock).not.toContain('해당 주차');
    expect(wizardFieldBlock).not.toContain('week');
    expect(bankStatementPageSource).toContain('aria-label="해당 주차 수정불가 계산값"');
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
    expect(bankStatementPageSource).toContain('w-[min(1800px,99vw)]');
    expect(bankStatementPageSource).toContain('max-h-[98vh]');
    expect(bankStatementPageSource).toContain('wizardSidebarCollapsed');
    expect(bankStatementPageSource).toContain('<<');
    expect(bankStatementPageSource).toContain('>>');
    expect(bankStatementPageSource).toContain('WIZARD_PRIMARY_FIELDS');
    expect(bankStatementPageSource).toContain('WIZARD_DEPOSIT_FIELDS');
    expect(bankStatementPageSource).toContain('WIZARD_WITHDRAWAL_FIELDS');
    expect(bankStatementPageSource).toContain('colSpan={WIZARD_DEPOSIT_FIELDS.length}');
    expect(bankStatementPageSource).toContain('colSpan={WIZARD_WITHDRAWAL_FIELDS.length}');
    expect(bankStatementPageSource).toContain('입금');
    expect(bankStatementPageSource).toContain('출금');
    expect(bankStatementPageSource).not.toContain('writing-mode-vertical');
    expect(bankStatementPageSource).not.toContain('wizardIssueSummary.amount + wizardIssueSummary.budget');
  });

  it('keeps user assistance inside temp state with classification-only bulk copy and undo controls', () => {
    expect(bankStatementPageSource).toContain('sameCounterpartySuggestions');
    expect(bankStatementPageSource).toContain('handleApplySuggestion');
    expect(bankStatementPageSource).toContain('handleBulkApplyWizardDraft');
    expect(bankStatementPageSource).toContain('WIZARD_BULK_CLASSIFICATION_FIELD_KEYS');
    expect(bankStatementPageSource).toContain('선택 행 분류만 복사');
    expect(bankStatementPageSource).toContain('handleWizardUndo');
    expect(bankStatementPageSource).toContain('wizardHistory');
    expect(bankStatementPageSource).toContain('오류 요약');

    const bulkApplyBlock = sourceBetween(
      bankStatementPageSource,
      'const handleBulkApplyWizardDraft = useCallback',
      'const handleApplyVatSplit = useCallback',
    );
    expect(bulkApplyBlock).toContain('WIZARD_BULK_CLASSIFICATION_FIELD_KEYS');
    expect(bulkApplyBlock).not.toContain('depositAmount');
    expect(bulkApplyBlock).not.toContain('vatRefund');
    expect(bulkApplyBlock).not.toContain('expenseAmount');
    expect(bulkApplyBlock).not.toContain('vatIn');
    expect(bulkApplyBlock).not.toContain('evidenceRequired');
    expect(bulkApplyBlock).not.toContain('memo');
    expect(bulkApplyBlock).not.toContain('settlementNote');
  });

  it('supports spreadsheet-style copy/paste only for classification cells', () => {
    expect(bankStatementPageSource).toContain('WIZARD_GRID_FIELD_KEYS');
    expect(bankStatementPageSource).toContain('wizardGridSelection');
    expect(bankStatementPageSource).toContain('parseClipboardGrid');
    expect(bankStatementPageSource).toContain("window.addEventListener('copy', onCopy)");
    expect(bankStatementPageSource).toContain("window.addEventListener('paste', onPaste)");
    expect(bankStatementPageSource).toContain('beginWizardGridSelection(rowKey, fieldKey)');
    expect(bankStatementPageSource).toContain('extendWizardGridSelection(rowKey, fieldKey)');
    expect(bankStatementPageSource).toContain('animate-pulse bg-blue-50 ring-2 ring-inset ring-blue-500');

    const gridKeyBlock = sourceBetween(
      bankStatementPageSource,
      'const WIZARD_GRID_FIELD_KEYS =',
      'const WIZARD_CASHFLOW_OPTIONS',
    );
    expect(gridKeyBlock).toContain('WIZARD_BULK_CLASSIFICATION_FIELD_KEYS');
    expect(gridKeyBlock).not.toContain('depositAmount');
    expect(gridKeyBlock).not.toContain('vatRefund');
    expect(gridKeyBlock).not.toContain('expenseAmount');
    expect(gridKeyBlock).not.toContain('vatIn');
  });

  it('keeps the wizard header and source bank columns fixed while the grid scrolls', () => {
    expect(bankStatementPageSource).toContain('flex min-h-0 min-w-0 flex-col overflow-hidden p-2');
    expect(bankStatementPageSource).toContain('min-h-0 flex-1 overflow-auto');
    expect(bankStatementPageSource).toContain('sticky top-0 z-30');
    expect(bankStatementPageSource).toContain('sticky left-[68px]');
    expect(bankStatementPageSource).toContain('통장내역 원본');
  });

  it('keeps bank statement page chrome minimal around the source table', () => {
    expect(bankStatementPageSource).not.toContain('사업비 입력(주간)으로 이어가기');
    expect(bankStatementPageSource).not.toContain('파일 다시 업로드');
    expect(bankStatementPageSource).not.toContain('기준본 저장');
    expect(bankStatementPageSource).not.toContain('업로드 원본 전체');
    expect(bankStatementPageSource).not.toContain('반영할 거래를 선택합니다');
    expect(bankStatementPageSource).not.toContain('getBankStatementProfileLabel');
    expect(bankStatementPageSource).not.toContain('lastSavedAt');
  });

  it('keeps cumulative bank statement uploads visible with a repeat upload entry', () => {
    expect(bankStatementPageSource).toContain('appendBankStatementRows');
    expect(bankStatementPageSource).toContain('const fullBaselineSheet = bankStatementRows || { columns, rows };');
    expect(bankStatementPageSource).toContain('appendBankStatementRows(fullBaselineSheet, result)');
    expect(bankStatementPageSource).toContain('누적 통장내역');
    expect(bankStatementPageSource).toContain('추가 업로드');
    expect(bankStatementPageSource).toContain("switchStatusTab('all')");
    expect(bankStatementPageSource).toContain('누적 거래');
    expect(bankStatementPageSource).toContain('미반영 거래');
    expect(bankStatementPageSource).toContain('반영완료 거래');
    expect(bankStatementPageSource).toContain('통장내역 ${mergedPreview.appendedRows.length.toLocaleString');
  });

  it('computes already applied bank lines across every expense sheet tab', () => {
    expect(bankStatementPageSource).toContain('expenseSheets.flatMap');
    expect(bankStatementPageSource).toContain('collectAppliedBankLineIds(rowsAcrossSheets.length > 0 ? rowsAcrossSheets : expenseSheetRows)');
  });

  it('does not save the whole dirty bank baseline before confirming wizard patches', () => {
    const submitBlock = sourceBetween(
      bankStatementPageSource,
      'const handleSubmitWizard = useCallback',
      'const getSubCategoryOptions = useCallback',
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
