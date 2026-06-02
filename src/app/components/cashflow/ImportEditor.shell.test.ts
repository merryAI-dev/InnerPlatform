import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ImportEditor.tsx'), 'utf8');
const portalWeeklyExpenseSource = readFileSync(
  resolve(import.meta.dirname, '../portal/PortalWeeklyExpensePage.tsx'),
  'utf8',
);

describe('ImportEditor row add controls', () => {
  it('keeps only the plain row add action on the grid toolbar', () => {
    expect(source).toContain('onClick={addRow}');
    expect(source).toContain('행 추가');
    expect(source).not.toContain('DropdownMenuTrigger');
    expect(source).not.toContain('addQuickInsertRow');
    expect(source).not.toContain('addTemplateRow');
    expect(source).not.toContain('입금 행');
    expect(source).not.toContain('지출 행');
    expect(source).not.toContain('잔액 조정 행');
    expect(source).not.toContain('정기지출: {template.label}');
    expect(source).not.toContain('입금 추가');
    expect(source).not.toContain('지출 추가');
    expect(source).not.toContain('정기지출 템플릿');
  });

  it('removes the portal-level quick insert bridge so row creation lives in the grid', () => {
    expect(portalWeeklyExpenseSource).not.toContain('queueQuickInsert');
    expect(portalWeeklyExpenseSource).not.toContain('pendingQuickInsert={pendingQuickInsert}');
    expect(portalWeeklyExpenseSource).not.toContain('입금 추가');
    expect(portalWeeklyExpenseSource).not.toContain('지출 추가');
  });
});
