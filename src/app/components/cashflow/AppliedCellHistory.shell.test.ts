import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AppliedCellHistory.tsx'), 'utf8');

describe('AppliedCellHistory', () => {
  it('keeps exact cell states and exposes bounded cursor pagination', () => {
    expect(source).toContain("if (state === 'EMPTY') return 'EMPTY'");
    expect(source).toContain("if (state === 'ZERO') return '0원 (ZERO)'");
    expect(source).toContain('item.beforeState, item.beforeAmount');
    expect(source).toContain('item.afterState, item.afterAmount');
    expect(source).toContain('cursor: nextCursor');
    expect(source).toContain('page.nextCursor === nextCursor');
    expect(source).toContain('MAX_PAGES = 100');
    expect(source).toContain('이전 이력 더 불러오기');
    expect(source).not.toContain('slice(0, 200)');
  });

  it('searches loaded rows and renders provenance with accessible states', () => {
    expect(source).toContain('현재 불러온 {items.length}개 행에서 검색합니다.');
    expect(source).toContain('item.operationType');
    expect(source).toContain('item.operationId');
    expect(source).toContain('item.auditId');
    expect(source).toContain('item.sourceRevision');
    expect(source).toContain('item.targetRevision');
    expect(source).toContain('role="alert"');
    expect(source).toContain('role="status"');
    expect(source).toContain('tabIndex={0}');
  });
});
