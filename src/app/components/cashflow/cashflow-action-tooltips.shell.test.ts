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
  it('does not explain removed manual actual sync and save actions', () => {
    expect(cashflowProjectSheetSource).not.toContain('주간 사업비 입력표에 저장된 실제 입금/지출을 읽어와');
    expect(cashflowProjectSheetSource).not.toContain('최종 반영은 Actual 저장까지 눌러야 끝납니다.');
    expect(cashflowProjectSheetSource).not.toContain('화면에 보이는 Actual 값을 서버 기준값으로 저장합니다.');
  });

  it('explains actual reflection from the weekly expense entry screen without implementation terms', () => {
    expect(importEditorSource).toContain('지금 보이는 주간 사업비 입력표를 저장 기준본으로 보관합니다.');
    expect(importEditorSource).toContain('Actual은 저장된 행을 기준으로 캐시플로 화면에 반영됩니다.');
    expect(importEditorSource).not.toContain('backend');
    expect(importEditorSource).not.toContain('Rust 계산');
  });
});
