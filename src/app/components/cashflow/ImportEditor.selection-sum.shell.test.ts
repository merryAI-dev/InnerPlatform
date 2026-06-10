import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const importEditorSource = readFileSync(
  resolve(import.meta.dirname, 'ImportEditor.tsx'),
  'utf8',
);

describe('ImportEditor spreadsheet-like amount selection summary', () => {
  it('sums only bank balance and bank in/out amount cells from the selected rectangle', () => {
    expect(importEditorSource).toContain('const selectedAmountSummary = useMemo');
    expect(importEditorSource).toContain('[balanceIdx, bankAmountIdx]');
    expect(importEditorSource).toContain('amountColumns.has(colIdx)');
    expect(importEditorSource).toContain('parseNumber(String(row.cells?.[colIdx] || \'\'))');
    expect(importEditorSource).toContain('data-testid="settlement-selection-amount-sum"');
    expect(importEditorSource).toContain('금액 합계: {selectedAmountSummary.sum.toLocaleString');
  });
});
