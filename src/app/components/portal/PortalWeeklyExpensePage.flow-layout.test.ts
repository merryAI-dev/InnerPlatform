import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'),
  'utf8',
);

describe('PortalWeeklyExpensePage flow layout', () => {
  it('surfaces bank-statement-to-weekly alignment with a saved-row message', () => {
    expect(weeklyExpenseSource).toContain('통장내역 기준본에서 이어서 작업');
    expect(weeklyExpenseSource).toContain('선택 반영된 지출정보와 저장 상태를 확인');
  });

  it('keeps direct-entry projects on saved rows instead of reopening a frontend editor', () => {
    expect(weeklyExpenseSource).toContain('직접 입력형 지출정보도 저장된 행 기준으로 확인합니다.');
    expect(weeklyExpenseSource).not.toContain('기존 시트 가져오기');
    expect(weeklyExpenseSource).not.toContain('입금 추가');
    expect(weeklyExpenseSource).not.toContain('지출 추가');
    expect(weeklyExpenseSource).not.toContain('잔액 조정');
  });

  it('removes top-level import and sheet-management actions from the weekly expense header', () => {
    expect(weeklyExpenseSource).not.toContain('엑셀/시트 불러오기');
    expect(weeklyExpenseSource).not.toContain('탭 추가');
    expect(weeklyExpenseSource).not.toContain('이름 변경');
    expect(weeklyExpenseSource).not.toContain('탭 삭제');
  });

  it('does not keep the retired saving loop or route-blocking overlay on the weekly dashboard', () => {
    expect(weeklyExpenseSource).not.toContain('isSettlementSaving');
    expect(weeklyExpenseSource).not.toContain('registerNavigationHandler');
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

  it('compresses status chrome into a single operator bar and keeps the work surface wide', () => {
    expect(weeklyExpenseSource).toContain('주간 화면은 저장된 행을 보여주고 이동만 담당합니다.');
    expect(weeklyExpenseSource).toContain('max-w-4xl text-[12px] text-muted-foreground');
    expect(weeklyExpenseSource).not.toContain('현재 입력 탭');
  });

  it('guards the setup panel so the page can render when no setup action is needed', () => {
    expect(weeklyExpenseSource).toMatch(/\{weeklySetupPanel \? \(\s*<Card data-testid="weekly-expense-setup-panel" className=\{weeklySetupPanel\.toneClass\}>/);
  });

  it('keeps cashflow projection and actual work out of the weekly expense screen', () => {
    expect(weeklyExpenseSource).not.toContain('buildProjectExpenseRowsForActualSync');
    expect(weeklyExpenseSource).not.toContain('projectActualSyncPayload');
    expect(weeklyExpenseSource).not.toContain('actual_realtime_sync');
    expect(weeklyExpenseSource).not.toContain('syncProjectCashflowActualsViaBff');
    expect(weeklyExpenseSource).not.toContain('onSyncCashflowActuals');
    expect(weeklyExpenseSource).not.toContain('expenseDashboardTotal');
    expect(weeklyExpenseSource).not.toContain('readSettlementAmount');
    expect(weeklyExpenseSource).not.toContain('Number(String(raw)');
    expect(weeklyExpenseSource).not.toContain('합계 {');
  });

  it('does not mount the cashflow ledger editor inside weekly expense', () => {
    expect(weeklyExpenseSource).toContain('data-testid="weekly-expense-dashboard-surface"');
    expect(weeklyExpenseSource).not.toContain('SettlementLedgerPage');
    expect(weeklyExpenseSource).not.toContain('onSaveSheetRows');
    expect(weeklyExpenseSource).not.toContain('pendingQuickInsert');
  });
});
