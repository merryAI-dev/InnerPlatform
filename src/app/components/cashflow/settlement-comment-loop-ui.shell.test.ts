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

  it('keeps review-loop UI out of the ledger editor while preserving cell comments', () => {
    expect(importEditorSource).not.toContain('검토 루프');
    expect(importEditorSource).toContain('셀 주석');
    expect(importEditorSource).not.toContain('후보값 또는 주석 확인 필요');
    expect(importEditorSource).not.toContain('행 왼쪽 배지에서 출처를 확인할 수 있습니다.');
    expect(importEditorSource).toContain('unlockDerivedFields');
    expect(importEditorSource).toContain('structureActionsEnabled={false}');
    expect(importEditorRowSource).toContain('행 작업');
    expect(importEditorRowSource).not.toContain('검토 완료');
    expect(importEditorRowSource).not.toContain('resolveCellSource');
    expect(importEditorRowSource).not.toContain('계산값');
    expect(importEditorRowSource).toContain('if (unlockDerivedFields) return false;');
    expect(cashflowProjectSheetSource).not.toContain('검토 루프 또는 동기화 확인');
    expect(importEditorSource).not.toContain('사람 확인');
    expect(importEditorRowSource).not.toContain('사람 확인');
    expect(cashflowProjectSheetSource).not.toContain('사람 확인');
  });
});
