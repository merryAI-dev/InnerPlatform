import { describe, expect, it } from 'vitest';
import {
  buildBudgetImportAiMatrixSample,
  buildBudgetImportAiRequestKey,
  resolveBudgetImportAiSheetName,
  shouldAnalyzeBudgetImportWithAi,
} from './budget-import-ai';

describe('budget-import-ai', () => {
  it('truncates matrix samples for AI analysis', () => {
    const matrix = Array.from({ length: 45 }, (_, rowIdx) => (
      Array.from({ length: 30 }, (_, colIdx) => `r${rowIdx + 1}c${colIdx + 1}`)
    ));

    const sample = buildBudgetImportAiMatrixSample(matrix);

    expect(sample).toHaveLength(40);
    expect(sample[0]).toHaveLength(24);
    expect(sample[39]?.[23]).toBe('r40c24');
  });

  it('resolves stable pseudo sheet names for pasted input', () => {
    expect(resolveBudgetImportAiSheetName({
      tab: 'paste',
      fileName: '',
      selectedSheetName: '',
    })).toBe('예산총괄(복붙)');

    expect(resolveBudgetImportAiSheetName({
      tab: 'file',
      fileName: 'budget.xlsx',
      selectedSheetName: '',
    })).toBe('예산총괄(budget.xlsx)');
  });

  it('requests AI help only for ambiguous imports', () => {
    expect(shouldAnalyzeBudgetImportWithAi({
      open: true,
      platformApiEnabled: true,
      tenantId: 'org-1',
      projectId: 'proj-1',
      matrix: [['비목', '세목'], ['인건비', '개인단위']],
      importedRowCount: 1,
      confidence: 'high',
      warningCount: 0,
      formatGuideRecommended: false,
    })).toBe(false);

    expect(shouldAnalyzeBudgetImportWithAi({
      open: true,
      platformApiEnabled: true,
      tenantId: 'org-1',
      projectId: 'proj-1',
      matrix: [['구분', '항목'], ['인건비', '개인단위']],
      importedRowCount: 0,
      confidence: 'low',
      warningCount: 1,
      formatGuideRecommended: true,
    })).toBe(true);
  });

  it('includes sample content in the AI request key', () => {
    const key = buildBudgetImportAiRequestKey({
      tenantId: 'org-1',
      projectId: 'proj-1',
      sheetName: '예산총괄(복붙)',
      matrix: [['비목', '세목'], ['인건비', '개인단위']],
    });

    expect(key).toContain('예산총괄(복붙)');
    expect(key).toContain('인건비');
  });
});
