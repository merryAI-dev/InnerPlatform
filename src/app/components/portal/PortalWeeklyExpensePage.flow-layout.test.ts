import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const weeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, 'PortalWeeklyExpensePage.tsx'),
  'utf8',
);

describe('PortalWeeklyExpensePage flow layout', () => {
  it('surfaces bank-statement-to-weekly alignment with a direct source message', () => {
    expect(weeklyExpenseSource).toContain('통장내역 기준본에서 이어서 작업');
  });

  it('makes direct-entry projects explicitly use the weekly sheet or excel template instead of bank upload wording', () => {
    expect(weeklyExpenseSource).toContain('주간 사업비 시트 또는 엑셀 템플릿으로 직접 입력');
    expect(weeklyExpenseSource).not.toContain('기존 시트 가져오기');
  });

  it('removes top-level import and sheet-management actions from the weekly expense header', () => {
    expect(weeklyExpenseSource).not.toContain('엑셀/시트 불러오기');
    expect(weeklyExpenseSource).not.toContain('탭 추가');
    expect(weeklyExpenseSource).not.toContain('이름 변경');
    expect(weeklyExpenseSource).not.toContain('탭 삭제');
  });

  it('shows a blocking full-screen saving overlay instead of the unsaved-changes dialog while save is in flight', () => {
    expect(weeklyExpenseSource).toContain('if (isSettlementSaving) return;');
    expect(weeklyExpenseSource).toContain('사업비 입력을 저장하고 있습니다');
    expect(weeklyExpenseSource).toContain('저장이 끝날 때까지 잠시 기다려 주세요.');
  });

  it('uses a Korean first-action heading instead of the previous English label', () => {
    expect(weeklyExpenseSource).toContain('지금 해야 할 일');
    expect(weeklyExpenseSource).not.toContain('Next Action');
  });

  it('compresses status chrome into a single operator bar and keeps the work surface wide', () => {
    expect(weeklyExpenseSource).toContain('원본 입력은 이 화면입니다.');
    expect(weeklyExpenseSource).toContain('max-w-4xl text-[12px] text-muted-foreground');
    expect(weeklyExpenseSource).not.toContain('현재 입력 탭');
  });

  it('guards the setup panel so the page can render when no setup action is needed', () => {
    expect(weeklyExpenseSource).toMatch(/\{weeklySetupPanel \? \(\s*<Card data-testid="weekly-expense-setup-panel" className=\{weeklySetupPanel\.toneClass\}>/);
  });
});
