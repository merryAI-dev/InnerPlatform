import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'),
  'utf8',
);

describe('PortalWeeklyExpensePage flow layout', () => {
  it('lets the portal shell own the page heading instead of rendering a duplicate body header', () => {
    expect(weeklyExpenseSource).not.toContain('<h2 className="text-base font-bold">사업비 입력(주간)</h2>');
    expect(weeklyExpenseSource).not.toContain('현재 탭: {activeSheetName}');
    expect(weeklyExpenseSource).not.toContain('거래 {expenseRowCount}건');
    expect(weeklyExpenseSource).not.toContain('통장내역 ${bankStatementCount}건 연결');
    expect(weeklyExpenseSource).not.toContain('기본 폴더 열기');
    expect(weeklyExpenseSource).not.toContain('기존 통장내역 가져오기');
    expect(weeklyExpenseSource).not.toContain('기존 시트 가져오기');
  });

  it('removes top-level import and sheet-management actions from the weekly expense header', () => {
    expect(weeklyExpenseSource).not.toContain('엑셀/시트 불러오기');
    expect(weeklyExpenseSource).not.toContain('탭 추가');
    expect(weeklyExpenseSource).not.toContain('이름 변경');
    expect(weeklyExpenseSource).not.toContain('탭 삭제');
    expect(weeklyExpenseSource).toContain('shouldShowExpenseSheetTabs');
    expect(weeklyExpenseSource).not.toContain("name: '기본 탭'");
  });

  it('shows a blocking full-screen saving overlay while save is in flight', () => {
    expect(weeklyExpenseSource).toContain('if (isSettlementSaving) {');
    expect(weeklyExpenseSource).toContain('이동은 저장이 끝난 뒤 가능합니다.');
    expect(weeklyExpenseSource).toContain('사업비 입력을 저장하고 있습니다');
    expect(weeklyExpenseSource).toContain('저장이 끝날 때까지 잠시 기다려 주세요.');
    expect(weeklyExpenseSource).toContain('w-[min(92vw,56rem)] max-w-none');
    expect(weeklyExpenseSource).toContain('min-h-[22rem]');
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

  it('keeps only the conditional setup panel above the work surface', () => {
    expect(weeklyExpenseSource).toContain('data-testid="weekly-expense-setup-panel"');
    expect(weeklyExpenseSource).toContain('max-w-4xl text-[12px] leading-6 text-slate-600');
    expect(weeklyExpenseSource).not.toContain('현재 입력 탭');
  });

  it('guards the setup panel so the page can render when no setup action is needed', () => {
    expect(weeklyExpenseSource).toMatch(/\{weeklySetupPanel \? \(\s*<Card data-testid="weekly-expense-setup-panel" className=\{weeklySetupPanel\.toneClass\}>/);
  });

  it('keeps cashflow actual sync tied to the full project expense-sheet source, not only the active tab save button', () => {
    expect(weeklyExpenseSource).toContain('buildProjectExpenseRowsForActualSync');
    expect(weeklyExpenseSource).toContain('projectActualSyncPayload');
    expect(weeklyExpenseSource).toContain('applyProjectActualSyncResultLocally({ projectId, result })');
    expect(weeklyExpenseSource).toContain('actual_realtime_sync');
  });
});
