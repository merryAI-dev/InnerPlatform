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

describe('cashflow action help tooltips', () => {
  it('explains actual sync and actual save in non-developer language', () => {
    expect(cashflowProjectSheetSource).toContain('주간 사업비 입력표에 저장된 실제 입금/지출을 읽어와');
    expect(cashflowProjectSheetSource).toContain('최종 반영은 Actual 저장까지 눌러야 끝납니다.');
    expect(cashflowProjectSheetSource).toContain('화면에 보이는 Actual 값을 서버 기준값으로 저장합니다.');
  });

  it('explains save and actual sync from the weekly expense entry screen', () => {
    expect(importEditorSource).toContain('지금 보이는 주간 사업비 입력표를 서버 기준본으로 보관합니다.');
    expect(importEditorSource).toContain('캐시플로 Actual 불러오기가 이어져 실제 입금/지출 값으로 캐시플로 화면에 반영됩니다.');
  });
});
