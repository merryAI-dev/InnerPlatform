import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cashflowProjectSheetSource = readFileSync(
  resolve(import.meta.dirname, 'CashflowProjectSheet.tsx'),
  'utf8',
);

const importEditorSource = readFileSync(
  resolve(import.meta.dirname, 'ImportEditor.tsx'),
  'utf8',
);

describe('cashflow action chrome', () => {
  it('removes secondary cashflow toolbar actions and explanatory chrome', () => {
    expect(cashflowProjectSheetSource).toContain('Projection - Actual 차이');
    expect(cashflowProjectSheetSource).toContain('현금흐름 관리시트 A11:BS11 기준');
    expect(cashflowProjectSheetSource).not.toContain('Actual - Projection');
    expect(cashflowProjectSheetSource).not.toContain('Actual에서 Projection을 뺀 값');
    expect(cashflowProjectSheetSource).not.toContain('actual - projection');
    expect(cashflowProjectSheetSource).not.toContain('diffColorExplanation');
    expect(cashflowProjectSheetSource).toContain('시트 수식값');
    expect(cashflowProjectSheetSource).not.toContain('엑셀 다운로드');
    expect(cashflowProjectSheetSource).not.toContain('Actual 불러오기');
    expect(cashflowProjectSheetSource).not.toContain('Actual 저장');
    expect(cashflowProjectSheetSource).not.toContain('이전 달로 이동');
    expect(cashflowProjectSheetSource).not.toContain('다음 달로 이동');
    expect(cashflowProjectSheetSource).not.toContain('주간 사업비 입력표에 저장된 실제 입금/지출을 읽어와');
    expect(cashflowProjectSheetSource).not.toContain('최종 반영은 Actual 저장까지 눌러야 끝납니다.');
    expect(cashflowProjectSheetSource).not.toContain('화면에 보이는 Actual 값을 서버 기준값으로 저장합니다.');
    expect(cashflowProjectSheetSource).not.toContain('비교 모드에서는 Firestore에 저장된 Projection과 Actual을 동시에 대조합니다.');
  });

  it('keeps weekly expense save free of explanatory chrome', () => {
    expect(importEditorSource).toContain('`${validCount}건 저장`');
    expect(importEditorSource).not.toContain('지금 보이는 주간 사업비 입력표를 서버 기준본으로 보관합니다.');
    expect(importEditorSource).not.toContain('캐시플로 Actual 불러오기가 이어져 실제 입금/지출 값으로 캐시플로 화면에 반영됩니다.');
  });

  it('uses zebra rows without decorative item-side color rails', () => {
    expect(cashflowProjectSheetSource).toContain("rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'");
    expect(cashflowProjectSheetSource).not.toContain("? 'border-l-slate-700 bg-white' : 'border-l-slate-400 bg-slate-50'");
    expect(cashflowProjectSheetSource).not.toContain('{sectionLabel}');
    expect(cashflowProjectSheetSource).not.toContain('<Badge variant="outline" className={row.section');
  });

  it('keeps final month close compact while preserving server validation', () => {
    expect(cashflowProjectSheetSource).toContain('buildCashflowMonthCloseDraftInput');
    expect(cashflowProjectSheetSource).toContain('월 결산 승인 요청');
    expect(cashflowProjectSheetSource).toContain('monthCloseActions?.requestMonthClose.enabled');
    expect(cashflowProjectSheetSource).toContain('monthCloseActions?.requestMonthClose.guide');
    // 2026-08-19: 막는 사유를 회색 안내 한 줄로만 보여줘서 경고인지 알 수 없었다. 이제 서버가 준
    // 블로커를 빨간 경고로 펴고, 어느 칸인지(셀 주소·주차)까지 보여준다. 판정은 서버 그대로 쓴다.
    expect(cashflowProjectSheetSource).toContain('monthCloseBlockers');
    expect(cashflowProjectSheetSource).toContain('describeCashflowMonthCloseIssue');
    expect(cashflowProjectSheetSource).toContain('월 결산을 진행할 수 없어요');
    expect(cashflowProjectSheetSource).not.toContain('validation.blockers.filter');
    expect(cashflowProjectSheetSource).not.toContain('validation.blockers.some');
    // 안내는 한 줄: 상태에서 결정적인 것 하나만(승인 대기면 "누가 요청·누가 승인·며칠째·회수는 요청자만").
    // 못 하는 이유를 다 나열하면 정보가 아니다(2026-08-19). 판정은 서버 것, 고르기만 한다.
    expect(cashflowProjectSheetSource).toContain('pickCashflowMonthCloseNotice({');
    expect(cashflowProjectSheetSource).toContain('requestedByUid: monthCloseRequest?.requestedByUid');
    expect(cashflowProjectSheetSource).toContain("monthCloseNotice.tone === 'attention' ? 'font-semibold text-red-700'");
    expect(cashflowProjectSheetSource).not.toContain('monthCloseActionNotices');
    expect(cashflowProjectSheetSource).not.toContain('캐시플로 항목 사람 확인');
    expect(cashflowProjectSheetSource).not.toContain('prepareAuditedWeekAmounts');
    expect(cashflowProjectSheetSource).not.toContain('showAuditBlock');
  });
});
