import { describe, expect, it } from 'vitest';
import {
  buildFallbackGoogleSheetMigrationAnalysis,
  createGoogleSheetMigrationAiService,
} from './google-sheet-migration-ai.mjs';

describe('google-sheet-migration-ai', () => {
  it('builds fallback analysis for grouped settlement headers', () => {
    const analysis = buildFallbackGoogleSheetMigrationAnalysis({
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: '사용내역(통장내역기준/취소내역,불인정포함)',
      matrix: [
        ['작성자', '입금합계', '사업팀', '정산지원', '도담', '비고'],
        ['No.', '입금액', '지급처', '상세 적요', '필수증빙자료 리스트', '비고'],
        ['메리', '100,000', '카페', '회의', '영수증', '샘플'],
      ],
    });

    expect(analysis.provider).toBe('heuristic');
    expect(analysis.likelyTarget).toBe('expense_sheet');
    expect(analysis.suggestedMappings.some((item) => item.sourceHeader.includes('입금합계'))).toBe(true);
    expect(analysis.usageTips.length).toBeGreaterThan(0);
  });

  it('falls back when anthropic key is missing', async () => {
    const service = createGoogleSheetMigrationAiService();
    const analysis = await service.analyzePreview({
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: '예산총괄시트',
      matrix: [
        ['사업비 구분', '비목', '세목', '최초 승인 예산'],
        ['사업비', '회의비', '다과비', '120000'],
      ],
    });

    expect(analysis.provider).toBe('heuristic');
    expect(analysis.likelyTarget).toBe('budget_plan');
  });

  it('treats e나라도움 cashflow guide tabs as guide-only targets', () => {
    const analysis = buildFallbackGoogleSheetMigrationAnalysis({
      spreadsheetTitle: '2026 사업비 관리 시트',
      selectedSheetName: 'cashflow(e나라도움 시 가이드)',
      matrix: [
        ['구분', '26-03-1', '26-03-2'],
        ['입금', '100000', '200000'],
      ],
    });

    expect(analysis.provider).toBe('heuristic');
    expect(analysis.likelyTarget).toBe('cashflow_guide');
  });
});
