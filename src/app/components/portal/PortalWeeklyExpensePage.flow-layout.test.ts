import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'),
  'utf8',
);
const settlementLedgerSource = readFileSync(
  resolve(import.meta.dirname, '../cashflow/SettlementLedgerPage.tsx'),
  'utf8',
);
const importEditorSource = readFileSync(
  resolve(import.meta.dirname, '../cashflow/ImportEditor.tsx'),
  'utf8',
);
const importEditorRowSource = readFileSync(
  resolve(import.meta.dirname, '../cashflow/ImportEditorRow.tsx'),
  'utf8',
);

describe('PortalWeeklyExpensePage flow layout', () => {
  it('keeps the original weekly expense input columns available through the settlement ledger', () => {
    expect(weeklyExpenseSource).toContain('SettlementLedgerPage');
    expect(weeklyExpenseSource).toContain('onSaveSheetRows={saveExpenseSheetRows}');
    expect(weeklyExpenseSource).toContain('sheetRows={expenseSheetRows}');
  });

  it('treats weekly expense as a view-only ledger and routes edits through the wizard policy', () => {
    expect(weeklyExpenseSource).toContain('ledgerViewOnly');
    expect(weeklyExpenseSource).toContain('사업비 입력은 원장 조회 화면입니다');
    expect(weeklyExpenseSource).toContain('금액/분류/지급정보 생성과 수정은 위자드에서만 처리합니다');
  });

  it('keeps the weekly view-only ledger fully fixed', () => {
    expect(settlementLedgerSource).toContain('() => []');
    expect(settlementLedgerSource).toContain('editableReadOnlyHeaders={ledgerViewOnlyEditableHeaders}');
    expect(importEditorSource).toContain('readOnly && !readOnlyHasEditableCells');
    expect(importEditorRowSource).toContain('editableReadOnlyHeaders.includes(col.csvHeader)');
    expect(importEditorRowSource).toContain("col.csvHeader === 'No.'");
  });

  it('does not wire weekly expense to cashflow actual sync from the frontend', () => {
    expect(weeklyExpenseSource).not.toContain('syncProjectCashflowActualsViaBff');
    expect(weeklyExpenseSource).not.toContain('onSyncCashflowActuals');
    expect(weeklyExpenseSource).not.toContain('updateVarianceFlag');
    expect(weeklyExpenseSource).not.toContain('VarianceFlagBanner');
    expect(weeklyExpenseSource).not.toContain('저장 후 actual 반영 상태를 같은 화면에서 확인');
    expect(weeklyExpenseSource).toContain('autoSaveSyncCashflow={false}');
  });

  it('removes top-level import and sheet-management actions from the weekly expense header', () => {
    expect(weeklyExpenseSource).not.toContain('엑셀/시트 불러오기');
    expect(weeklyExpenseSource).not.toContain('탭 추가');
    expect(weeklyExpenseSource).not.toContain('이름 변경');
    expect(weeklyExpenseSource).not.toContain('탭 삭제');
  });

  it('does not keep the retired route-blocking overlay on the weekly input screen', () => {
    expect(weeklyExpenseSource).not.toContain('beforeunload');
    expect(weeklyExpenseSource).not.toContain('이동은 저장이 끝난 뒤 가능합니다.');
    expect(weeklyExpenseSource).not.toContain('사업비 입력을 저장하고 있습니다');
  });

  it('does not block route changes with the retired unsaved weekly expense dialog', () => {
    expect(weeklyExpenseSource).not.toContain('data-testid="weekly-expense-unsaved-dialog"');
    expect(weeklyExpenseSource).not.toContain('저장되지 않은 사업비 입력이 있습니다');
    expect(weeklyExpenseSource).not.toContain('지금 이동하면 저장되지 않은 사업비 입력(주간) 편집 내용이 유실될 수 있습니다.');
  });

  it('uses a Korean first-action heading instead of the previous English label', () => {
    expect(weeklyExpenseSource).toContain('지금 해야 할 일');
    expect(weeklyExpenseSource).not.toContain('Next Action');
  });

  it('keeps projection and actual comparison out of the weekly header copy', () => {
    expect(weeklyExpenseSource).not.toContain('Projection/Actual 비교');
    expect(weeklyExpenseSource).not.toContain('expenseDashboardTotal');
  });

  it('guards the setup panel so the page can render when no setup action is needed', () => {
    expect(weeklyExpenseSource).toMatch(/\{weeklySetupPanel \? \(\s*<Card data-testid="weekly-expense-setup-panel" className=\{weeklySetupPanel\.toneClass\}>/);
  });

  it('does not mount the Google Sheet migration wizard inside weekly expense', () => {
    expect(weeklyExpenseSource).not.toContain('GoogleSheetMigrationWizard');
    expect(weeklyExpenseSource).not.toContain('googleSheetImportOpen');
  });

  it('wires Google Workspace access through the auth store instead of an undefined global', () => {
    expect(weeklyExpenseSource).toContain('const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();');
    expect(weeklyExpenseSource).toContain('await ensureGoogleWorkspaceAccess()');
  });
});
