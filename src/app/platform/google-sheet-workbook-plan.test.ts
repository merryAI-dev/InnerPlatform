import { describe, expect, it } from 'vitest';
import {
  classifyGoogleSheetRuleFamily,
  planGoogleSheetWorkbook,
} from './google-sheet-workbook-plan';

describe('google-sheet-workbook-plan', () => {
  it('classifies workbook sheets into rule families', () => {
    expect(classifyGoogleSheetRuleFamily('통장내역(MYSC법인계좌e나라도움제외)')).toBe('BANK_STATEMENT');
    expect(classifyGoogleSheetRuleFamily('사용내역(통장내역기준취소내역,불인정포함)')).toBe('USAGE_LEDGER');
    expect(classifyGoogleSheetRuleFamily('예산총괄시트')).toBe('BUDGET_PLAN');
    expect(classifyGoogleSheetRuleFamily('cashflow(사용내역 연동)')).toBe('CASHFLOW');
    expect(classifyGoogleSheetRuleFamily('비목별 증빙자료')).toBe('EVIDENCE_RULES');
    expect(classifyGoogleSheetRuleFamily('그룹통장내역')).toBe('GROUP_BANK_STATEMENT');
    expect(classifyGoogleSheetRuleFamily('그룹지출대장(취소내역,불인정포함)')).toBe('GROUP_LEDGER');
    expect(classifyGoogleSheetRuleFamily('그룹예산')).toBe('GROUP_BUDGET');
    expect(classifyGoogleSheetRuleFamily('그룹cashflow(지출대장 연동)')).toBe('GROUP_CASHFLOW');
    expect(classifyGoogleSheetRuleFamily('인력투입률')).toBe('PARTICIPATION');
    expect(classifyGoogleSheetRuleFamily('(참고) 원천세 계산기')).toBe('WITHHOLDING_TAX');
    expect(classifyGoogleSheetRuleFamily('(옵션) 해외출장 비용사용내역 별도관리시트')).toBe('OPTIONAL_TRAVEL_LEDGER');
    expect(classifyGoogleSheetRuleFamily('FAQ')).toBe('REFERENCE');
  });

  it('builds whole-workbook execution order and dependencies', () => {
    const plan = planGoogleSheetWorkbook([
      'FAQ',
      '안내사항기본정보',
      '예산총괄시트',
      '비목별 증빙자료',
      'cashflow(사용내역 연동)',
      'cashflow(e나라도움 시 가이드)',
      '사용내역(통장내역기준취소내역,불인정포함)',
      '정산보완요청',
      '통장내역(MYSC법인계좌e나라도움제외)',
      '인력투입률',
      '(참고) 원천세 계산기',
      '(옵션) 해외출장 비용사용내역 별도관리시트',
      '그룹예산',
      '그룹cashflow(지출대장 연동)',
      '그룹지출대장(취소내역,불인정포함)',
      '그룹통장내역',
      '그룹최종정산제출',
    ]);

    expect(plan.executionOrder.map((item) => item.sheetName).slice(0, 6)).toEqual([
      '통장내역(MYSC법인계좌e나라도움제외)',
      '사용내역(통장내역기준취소내역,불인정포함)',
      '예산총괄시트',
      'cashflow(사용내역 연동)',
      'cashflow(e나라도움 시 가이드)',
      '비목별 증빙자료',
    ]);
    expect(plan.missingDependencies).toEqual([]);
    expect(plan.unknownSheets).toEqual([]);
    expect(plan.waveSummaries.find((item) => item.wave === 'CORE')?.sheetNames).toEqual([
      '통장내역(MYSC법인계좌e나라도움제외)',
      '사용내역(통장내역기준취소내역,불인정포함)',
      '예산총괄시트',
      'cashflow(사용내역 연동)',
      'cashflow(e나라도움 시 가이드)',
      '비목별 증빙자료',
    ]);
  });

  it('surfaces dependency gaps when upstream ledger sheets are missing', () => {
    const plan = planGoogleSheetWorkbook([
      '예산총괄시트',
      'cashflow(사용내역 연동)',
      '그룹예산',
    ]);

    expect(plan.missingDependencies).toEqual([
      {
        sheetName: '예산총괄시트',
        family: 'BUDGET_PLAN',
        missingFamilies: ['USAGE_LEDGER'],
      },
      {
        sheetName: 'cashflow(사용내역 연동)',
        family: 'CASHFLOW',
        missingFamilies: ['USAGE_LEDGER'],
      },
      {
        sheetName: '그룹예산',
        family: 'GROUP_BUDGET',
        missingFamilies: ['GROUP_LEDGER'],
      },
    ]);
  });
});
