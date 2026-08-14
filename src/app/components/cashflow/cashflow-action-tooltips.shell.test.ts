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
    expect(cashflowProjectSheetSource).not.toContain('dashboard?.validation?.blockers');
    expect(cashflowProjectSheetSource).not.toContain('캐시플로 항목 사람 확인');
    expect(cashflowProjectSheetSource).not.toContain('prepareAuditedWeekAmounts');
    expect(cashflowProjectSheetSource).not.toContain('showAuditBlock');
  });
});
