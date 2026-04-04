import { describe, expect, it } from 'vitest';
import {
  describeGoogleSheetMigrationTarget,
  parseBankStatementMatrix,
  parseBudgetPlanMatrix,
  parseCashflowProjectionMatrix,
  parseEvidenceRuleMatrix,
  planBudgetPlanMerge,
  resolveProjectSheetSourceType,
} from './google-sheet-migration';

describe('google-sheet-migration', () => {
  it('classifies workbook tabs into migration targets', () => {
    expect(describeGoogleSheetMigrationTarget('사용내역(통장내역기준취소내역,불인정포함)').target).toBe('expense_sheet');
    expect(describeGoogleSheetMigrationTarget('그룹지출대장(취소내역,불인정포함)').target).toBe('expense_sheet');
    expect(describeGoogleSheetMigrationTarget('예산총괄시트').target).toBe('budget_plan');
    expect(describeGoogleSheetMigrationTarget('비목별 증빙자료').target).toBe('evidence_rules');
    expect(describeGoogleSheetMigrationTarget('증빙서류(2025업데이트)').target).toBe('evidence_rules');
    expect(describeGoogleSheetMigrationTarget('통장내역(MYSC법인계좌e나라도움제외)').target).toBe('bank_statement');
    expect(describeGoogleSheetMigrationTarget('cashflow(사용내역 연동)').target).toBe('cashflow_projection');
    expect(describeGoogleSheetMigrationTarget('cashflow(e나라도움 시 가이드)').target).toBe('cashflow_guide');
    expect(describeGoogleSheetMigrationTarget('인력투입률').target).toBe('preview_only');
  });

  it('parses budget summary matrices into budget rows and code book', () => {
    const matrix = [
      ['사업명', '테스트 사업'],
      ['구분', '안내'],
      ['사업비 구분', '비목', '세목', '산정 내역', '최초 승인 예산', '변경 승인 예산', '특이사항'],
      ['직접사업비', '여비', '교통비', 'KTX 2회', '100,000', '120,000', '수정'],
      ['직접사업비', '', '숙박비', '호텔 1박', '80,000', '', ''],
      ['직접사업비', '회의비', '소계', '', '180,000', '', ''],
      ['직접사업비', '회의비', '다과비', '회의 2회', '50,000', '', '필수'],
    ];

    const result = parseBudgetPlanMatrix(matrix);

    expect(result.rows).toEqual([
      {
        budgetCode: '여비',
        subCode: '교통비',
        initialBudget: 100000,
        revisedBudget: 120000,
        note: 'KTX 2회 | 수정',
      },
      {
        budgetCode: '여비',
        subCode: '숙박비',
        initialBudget: 80000,
        note: '호텔 1박',
      },
      {
        budgetCode: '회의비',
        subCode: '다과비',
        initialBudget: 50000,
        note: '회의 2회 | 필수',
      },
    ]);
    expect(result.codeBook).toEqual([
      { code: '여비', subCodes: ['교통비', '숙박비'] },
      { code: '회의비', subCodes: ['다과비'] },
    ]);
  });

  it('parses special workbook budget summary headers with 구분/변경 예산', () => {
    const matrix = [
      ['안내', '환경AC'],
      ['구분', '비목', '세목', '최초 승인 예산', '변경 예산', '산정 내역'],
      ['직접사업비', '여비', '교통비', '100,000', '150,000', '출장 3회'],
      ['', '', '숙박비', '80,000', '', '숙박 1박'],
    ];

    const result = parseBudgetPlanMatrix(matrix);

    expect(result.rows).toEqual([
      {
        budgetCode: '여비',
        subCode: '교통비',
        initialBudget: 100000,
        revisedBudget: 150000,
        note: '출장 3회',
      },
      {
        budgetCode: '여비',
        subCode: '숙박비',
        initialBudget: 80000,
        note: '숙박 1박',
      },
    ]);
  });

  it('parses multi-row budget headers and carries forward blank 비목 rows', () => {
    const matrix = [
      ['프로젝트 정보', '', '', '예산 정보', '예산 정보', '메모'],
      ['사업비 구분', '비목명', '세목명', '당초 예산', '수정 예산', '비고'],
      ['직접사업비', '인건비', '개인단위', '100,000', '', '개인 기준'],
      ['직접사업비', '', '계약클라이언트', '200,000', '210,000', '클라이언트 기준'],
      ['직접사업비', '인건비', '소계', '300,000', '', ''],
    ];

    const result = parseBudgetPlanMatrix(matrix);

    expect(result.rows).toEqual([
      {
        budgetCode: '인건비',
        subCode: '개인단위',
        initialBudget: 100000,
        note: '개인 기준',
      },
      {
        budgetCode: '인건비',
        subCode: '계약클라이언트',
        initialBudget: 200000,
        revisedBudget: 210000,
        note: '클라이언트 기준',
      },
    ]);
    expect(result.confidence).toBe('high');
  });

  it('handles reordered columns and extra text columns around the budget fields', () => {
    const matrix = [
      ['안내', '이 시트는 수정 가능'],
      ['계약클라이언트', '세목', '비목', '비고', '변경후 예산', '당초예산'],
      ['KOICA', '교통비', '여비', '현장 방문', '150,000', '100,000'],
      ['KOICA', '숙박비', '', '', '', '80,000'],
    ];

    const result = parseBudgetPlanMatrix(matrix);

    expect(result.rows).toEqual([
      {
        budgetCode: '여비',
        subCode: '교통비',
        initialBudget: 100000,
        revisedBudget: 150000,
        note: '현장 방문',
      },
      {
        budgetCode: '여비',
        subCode: '숙박비',
        initialBudget: 80000,
      },
    ]);
    expect(result.codeBook).toEqual([
      { code: '여비', subCodes: ['교통비', '숙박비'] },
    ]);
  });

  it('surfaces low-confidence warnings when it has to infer budget columns', () => {
    const matrix = [
      ['메타', '예산안'],
      ['항목A', '항목B', '금액1', '금액2', '설명'],
      ['인건비', '개인단위', '100,000', '110,000', '내부안'],
      ['', '계약클라이언트', '200,000', '210,000', '외부안'],
    ];

    const result = parseBudgetPlanMatrix(matrix);

    expect(result.rows).toEqual([
      {
        budgetCode: '인건비',
        subCode: '개인단위',
        initialBudget: 100000,
        revisedBudget: 110000,
        note: '내부안',
      },
      {
        budgetCode: '인건비',
        subCode: '계약클라이언트',
        initialBudget: 200000,
        revisedBudget: 210000,
        note: '외부안',
      },
    ]);
    expect(result.confidence).toBe('low');
    expect(result.formatGuideRecommended).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);
  });

  it('merges budget rows by 비목/세목 without dropping unmatched existing rows', () => {
    const existing = [
      { budgetCode: '여비', subCode: '교통비', initialBudget: 100000, note: '기존' },
      { budgetCode: '회의비', subCode: '다과비', initialBudget: 50000 },
    ];
    const imported = [
      { budgetCode: '여비', subCode: '교통비', initialBudget: 120000, note: '갱신' },
      { budgetCode: '홍보비', subCode: '보도자료', initialBudget: 70000 },
    ];

    const plan = planBudgetPlanMerge(existing, imported);

    expect(plan.mergedRows).toEqual([
      { budgetCode: '여비', subCode: '교통비', initialBudget: 120000, note: '갱신' },
      { budgetCode: '회의비', subCode: '다과비', initialBudget: 50000 },
      { budgetCode: '홍보비', subCode: '보도자료', initialBudget: 70000 },
    ]);
    expect(plan.summary).toEqual({
      importedCount: 2,
      createCount: 1,
      updateCount: 1,
      unchangedCount: 0,
    });
    expect(plan.codeBook).toEqual([
      { code: '여비', subCodes: ['교통비'] },
      { code: '회의비', subCodes: ['다과비'] },
      { code: '홍보비', subCodes: ['보도자료'] },
    ]);
    expect(plan.importedRows).toEqual(imported);
    expect(plan.importedCodeBook).toEqual([
      { code: '여비', subCodes: ['교통비'] },
      { code: '홍보비', subCodes: ['보도자료'] },
    ]);
  });

  it('keeps month-prefixed sub codes distinct during merge', () => {
    const existing = [
      { budgetCode: '인건비', subCode: '9월 인건비', initialBudget: 19527400 },
      { budgetCode: '인건비', subCode: '10월 인건비', initialBudget: 0 },
    ];
    const imported = [
      { budgetCode: '1. 인건비', subCode: '10월 인건비', initialBudget: 21000000 },
    ];

    const plan = planBudgetPlanMerge(existing, imported);

    expect(plan.mergedRows).toEqual([
      { budgetCode: '인건비', subCode: '9월 인건비', initialBudget: 19527400 },
      { budgetCode: '인건비', subCode: '10월 인건비', initialBudget: 21000000 },
    ]);
    expect(plan.summary).toEqual({
      importedCount: 1,
      createCount: 0,
      updateCount: 1,
      unchangedCount: 0,
    });
  });

  it('parses evidence rule matrices with intermediate category columns', () => {
    const matrix = [
      ['안내', '증빙 작성법'],
      ['비목', '중분류', '세목', '사전 업로드', '사후 업로드'],
      ['여비', '', '교통비', '출장신청서', '영수증'],
      ['', '', '숙박비', '', '영수증\n이체확인증'],
      ['강사비', '', '외부강사비', '이력서', '원천세 내역'],
    ];

    const result = parseEvidenceRuleMatrix(matrix);

    expect(result.map).toEqual({
      '여비|교통비': '출장신청서\n영수증',
      '여비|숙박비': '영수증\n이체확인증',
      '강사비|외부강사비': '이력서\n원천세 내역',
    });
  });

  it('parses evidence rule matrices from 증빙서류 탭 variants', () => {
    const matrix = [
      ['안내', '증빙 가이드'],
      ['비목', '세목', '필수 증빙 자료', '회계법인 추가 요청했던 자료'],
      ['여비', '교통비', '출장신청서\n영수증', '지출결의서'],
      ['', '숙박비', '영수증', '이체확인증'],
    ];

    const result = parseEvidenceRuleMatrix(matrix);

    expect(result.map).toEqual({
      '여비|교통비': '출장신청서\n영수증\n지출결의서',
      '여비|숙박비': '영수증\n이체확인증',
    });
  });

  it('parses cashflow projection matrices into week upserts', () => {
    const matrix = [
      ['구분', '설명', '26-03-1', '26-03-2', '26-04-1'],
      ['매출액(입금)', '', '1,000,000', '2,000,000', '3,000,000'],
      ['직접사업비', '', '400,000', '500,000', ''],
      ['매입부가세', '', '40,000', '', '60,000'],
    ];

    const result = parseCashflowProjectionMatrix(matrix);

    expect(result.sheets).toEqual([
      {
        yearMonth: '2026-03',
        weekNo: 1,
        amounts: {
          SALES_IN: 1000000,
          DIRECT_COST_OUT: 400000,
          INPUT_VAT_OUT: 40000,
        },
      },
      {
        yearMonth: '2026-03',
        weekNo: 2,
        amounts: {
          SALES_IN: 2000000,
          DIRECT_COST_OUT: 500000,
        },
      },
      {
        yearMonth: '2026-04',
        weekNo: 1,
        amounts: {
          SALES_IN: 3000000,
          INPUT_VAT_OUT: 60000,
        },
      },
    ]);
  });

  it('parses cashflow projection matrices from existing workbook variants', () => {
    const matrix = [
      ['2026 캐시플로우'],
      ['구분', '항목', '2026-03-1주', '2026.03-2주', '2026년 4월 1주'],
      ['입금', '매출액(입금)', '1,000,000', '2,000,000', '3,000,000'],
      ['출금', '직접사업비', '400,000', '500,000', ''],
      ['출금', '매입부가세', '40,000', '', '60,000'],
    ];

    const result = parseCashflowProjectionMatrix(matrix);

    expect(result.sheets).toEqual([
      {
        yearMonth: '2026-03',
        weekNo: 1,
        amounts: {
          SALES_IN: 1000000,
          DIRECT_COST_OUT: 400000,
          INPUT_VAT_OUT: 40000,
        },
      },
      {
        yearMonth: '2026-03',
        weekNo: 2,
        amounts: {
          SALES_IN: 2000000,
          DIRECT_COST_OUT: 500000,
        },
      },
      {
        yearMonth: '2026-04',
        weekNo: 1,
        amounts: {
          SALES_IN: 3000000,
          INPUT_VAT_OUT: 60000,
        },
      },
    ]);
  });

  it('resolves sheet source types from migration targets', () => {
    expect(resolveProjectSheetSourceType('expense_sheet')).toBe('usage');
    expect(resolveProjectSheetSourceType('budget_plan')).toBe('budget');
    expect(resolveProjectSheetSourceType('evidence_rules')).toBe('evidence_rules');
    expect(resolveProjectSheetSourceType('cashflow_projection')).toBe('cashflow');
    expect(resolveProjectSheetSourceType('cashflow_guide')).toBe('cashflow');
    expect(resolveProjectSheetSourceType('bank_statement')).toBe('bank_statement');
    expect(resolveProjectSheetSourceType('preview_only')).toBeNull();
  });

  it('normalizes bank statement matrices into structured sheets', () => {
    const matrix = [
      ['은행명', '테스트 계좌'],
      ['거래일시', '적요', '출금금액', '입금금액', '잔액'],
      ['2026-03-02 10:00', '법인카드 결제', '15,000', '', '985,000'],
      ['2026-03-03 15:00', '입금', '', '250,000', '1,235,000'],
    ];

    const result = parseBankStatementMatrix(matrix);

    expect(result.columns).toEqual(['거래일시', '적요', '출금금액', '입금금액', '잔액']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.cells?.[0]).toBe('2026-03-02 10:00');
    expect(result.rows[1]?.cells?.[3]).toBe('250,000');
  });
});
