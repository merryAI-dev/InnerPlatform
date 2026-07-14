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
    expect(cashflowProjectSheetSource).toContain('차이 = Projection - Actual');
    expect(cashflowProjectSheetSource).not.toContain('Actual - Projection');
    expect(cashflowProjectSheetSource).not.toContain('Actual에서 Projection을 뺀 값');
    expect(cashflowProjectSheetSource).not.toContain('actual - projection');
    expect(cashflowProjectSheetSource).toContain('diffColorExplanation');
    expect(cashflowProjectSheetSource).toContain('차이 항목만');
    expect(cashflowProjectSheetSource).toContain('BFF 기준일');
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

  it('uses row color instead of income or expense text badges in cashflow item cells', () => {
    expect(cashflowProjectSheetSource).toContain('bg-emerald-50/80 border-l-[3px] border-l-emerald-400');
    expect(cashflowProjectSheetSource).toContain('bg-rose-50/80 border-l-[3px] border-l-rose-400');
    expect(cashflowProjectSheetSource).not.toContain('{sectionLabel}');
    expect(cashflowProjectSheetSource).not.toContain('<Badge variant="outline" className={row.section');
  });

  it('blocks final month close until the server and human-confirmation contract pass', () => {
    expect(cashflowProjectSheetSource).toContain('buildCashflowMonthCloseDraftInput');
    expect(cashflowProjectSheetSource).toContain('monthCloseProgress.complete');
    expect(cashflowProjectSheetSource).toContain('dashboard?.validation?.blockers');
    expect(cashflowProjectSheetSource).toContain('캐시플로 항목 사람 확인');
    expect(cashflowProjectSheetSource).not.toContain('prepareAuditedWeekAmounts');
    expect(cashflowProjectSheetSource).not.toContain('showAuditBlock');
  });
});
