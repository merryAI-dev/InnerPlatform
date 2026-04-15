import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPortalSource(fileName: string) {
  return readFileSync(resolve(import.meta.dirname, fileName), 'utf8');
}

const submissionsSource = readPortalSource('PortalSubmissionsPage.tsx');
const bankStatementSource = readPortalSource('PortalBankStatementPage.tsx');
const weeklyExpenseSource = readPortalSource('PortalWeeklyExpensePage.tsx');
const cashflowSource = readPortalSource('PortalCashflowPage.tsx');
const projectSettingsSource = readPortalSource('PortalProjectSettings.tsx');
const projectEditSource = readPortalSource('PortalProjectEdit.tsx');
const projectRegisterSource = readPortalSource('PortalProjectRegister.tsx');

describe('portal minimal sweep', () => {
  it('trims explanatory copy and empty-state coaching from submissions', () => {
    expect(submissionsSource).not.toContain('제출한 항목의 진행 상태(제출/승인/반려)를 한 곳에서 확인합니다.');
    expect(submissionsSource).not.toContain('실제 저장 데이터 기준 자동 반영');
    expect(submissionsSource).not.toContain('필요시만 수동 보정');
    expect(submissionsSource).not.toContain('아직 추적 중인 제출 대상이 없습니다');
    expect(submissionsSource).not.toContain('해당 상태의 인력변경 신청이 없습니다');
  });

  it('removes walkthrough and role-notice clutter from bank statements', () => {
    expect(bankStatementSource).not.toContain('const helperSteps = [');
    expect(bankStatementSource).not.toContain('Mission 1');
    expect(bankStatementSource).not.toContain('roleNotice');
    expect(bankStatementSource).not.toContain('사업비 입력(주간) 먼저 보기');
  });

  it('restores direct bank-to-weekly-expense continuation and removes queue-first controls', () => {
    expect(bankStatementSource).toContain('사업비 입력(주간)으로 이어가기');
    expect(bankStatementSource).not.toContain('신규 거래 처리 Queue');
    expect(bankStatementSource).not.toContain('분류/검토 열기');
    expect(bankStatementSource).not.toContain('증빙 이어서 하기');
    expect(bankStatementSource).not.toContain('주간 사업비에서 보기');
  });

  it('removes operator-facing special template actions from bank statements', () => {
    expect(bankStatementSource).not.toContain('환수 행');
    expect(bankStatementSource).not.toContain('선사용금');
    expect(bankStatementSource).not.toContain('특이건');
    expect(bankStatementSource).not.toContain('addSpecialTemplateRow(');
  });

  it('removes redundant policy and bottom summary bars from weekly expenses', () => {
    expect(weeklyExpenseSource).not.toContain('현재 정책:');
    expect(weeklyExpenseSource).not.toContain('<span>시트 정책:');
    expect(weeklyExpenseSource).not.toContain('<span>거래:');
    expect(weeklyExpenseSource).not.toContain('<span>기본 폴더:');
  });

  it('removes the weekly expense queue strip and queue-first wizard CTA', () => {
    expect(weeklyExpenseSource).not.toContain('weekly-intake-queue-strip');
    expect(weeklyExpenseSource).not.toContain('통장내역에서 아직 정리되지 않은 거래');
    expect(weeklyExpenseSource).not.toContain('분류/검토 열기');
    expect(weeklyExpenseSource).not.toContain('증빙 이어서 하기');
  });

  it('turns cashflow migration guidance into a compact action instead of a top explainer card', () => {
    expect(cashflowSource).not.toContain('기존 캐시플로 형식 그대로 migration 할 수 있습니다.');
    expect(cashflowSource).not.toContain('권장 형식: 첫 1~2열에 항목명');
  });

  it('reduces duplicate state banners from project settings', () => {
    expect(projectSettingsSource).not.toContain('최근 사용한 사업');
    expect(projectSettingsSource).not.toContain('최근 사용한 사업과 현재 주사업');
  });

  it('drops the redundant current-project subtitle from project edit', () => {
    expect(projectEditSource).not.toContain('현재 프로젝트:');
  });

  it('removes dash placeholders and review coaching from project register summaries', () => {
    expect(projectRegisterSource).not.toContain('제출 전 최종 확인');
    expect(projectRegisterSource).not.toContain("|| '-'");
    expect(projectRegisterSource).not.toContain("field.value || '-'");
  });
});
