import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const componentDir = import.meta.dirname;

const commentSheetSource = readFileSync(
  resolve(componentDir, 'SettlementCommentThreadSheet.tsx'),
  'utf8',
);

const commentButtonSource = readFileSync(
  resolve(componentDir, 'CellCommentButton.tsx'),
  'utf8',
);

const importEditorSource = readFileSync(
  resolve(componentDir, 'ImportEditor.tsx'),
  'utf8',
);

const importEditorRowSource = readFileSync(
  resolve(componentDir, 'ImportEditorRow.tsx'),
  'utf8',
);

const cashflowProjectSheetSource = readFileSync(
  resolve(componentDir, 'CashflowProjectSheet.tsx'),
  'utf8',
);

describe('settlement comment and review loop UI copy', () => {
  it('uses comment language and quick loop helpers for cell notes', () => {
    expect(commentSheetSource).toContain('셀 주석');
    expect(commentSheetSource).toContain('QUICK_COMMENT_TEMPLATES');
    expect(commentSheetSource).toContain('논의 중');
    expect(commentSheetSource).toContain('주석 등록');
    expect(commentSheetSource).toContain('검토 내용, 수정 근거, 확인 결과를 남겨주세요');
    expect(commentButtonSource).toContain('셀 주석 열기');
    expect(commentButtonSource).not.toContain('셀 메모');
  });

  it('keeps sheet import work in the review loop without the former per-cell month-close checklist', () => {
    expect(importEditorSource).toContain('검토 루프');
    expect(importEditorSource).toContain('셀 주석');
    expect(importEditorSource).toContain('후보값 또는 주석 확인 필요');
    expect(importEditorRowSource).toContain('행 작업');
    expect(importEditorRowSource).toContain('검토 완료');
    expect(importEditorSource).not.toContain('사람 확인');
    expect(importEditorRowSource).not.toContain('사람 확인');
    expect(cashflowProjectSheetSource).not.toContain('캐시플로 항목 사람 확인');
  });
});
