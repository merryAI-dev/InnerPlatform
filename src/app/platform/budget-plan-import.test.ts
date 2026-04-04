import { describe, expect, it } from 'vitest';
import {
  mergeBudgetCodeBooks,
  parseBudgetPlanImportText,
  selectBudgetPlanImportSheet,
} from './budget-plan-import';

describe('budget-plan-import', () => {
  it('parses tab-separated clipboard text into a matrix', () => {
    expect(parseBudgetPlanImportText(
      '비목\t세목\t최초 승인 예산\n여비\t교통비\t100,000\n여비\t숙박비\t80,000\n',
    )).toEqual([
      ['비목', '세목', '최초 승인 예산'],
      ['여비', '교통비', '100,000'],
      ['여비', '숙박비', '80,000'],
    ]);
  });

  it('prefers budget summary sheets when choosing an import sheet', () => {
    const picked = selectBudgetPlanImportSheet([
      {
        name: 'Sheet1',
        matrix: [
          ['안내', '메모'],
          ['foo', 'bar'],
        ],
      },
      {
        name: '1.예산총괄시트',
        matrix: [
          ['사업비 구분', '비목', '세목', '최초 승인 예산'],
          ['직접사업비', '여비', '교통비', '100,000'],
        ],
      },
      {
        name: '사용내역',
        matrix: [
          ['거래일시', '적요'],
          ['2026-04-01', '테스트'],
        ],
      },
    ]);

    expect(picked?.name).toBe('1.예산총괄시트');
  });

  it('merges imported code book entries without dropping existing extras', () => {
    expect(mergeBudgetCodeBooks(
      [
        { code: '여비', subCodes: ['교통비'] },
        { code: '회의비', subCodes: ['다과비'] },
      ],
      [
        { code: '여비', subCodes: ['교통비', '숙박비'] },
        { code: '홍보비', subCodes: ['보도자료'] },
      ],
    )).toEqual([
      { code: '여비', subCodes: ['교통비', '숙박비'] },
      { code: '회의비', subCodes: ['다과비'] },
      { code: '홍보비', subCodes: ['보도자료'] },
    ]);
  });
});
