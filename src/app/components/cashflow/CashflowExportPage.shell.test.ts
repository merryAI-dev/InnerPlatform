import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowExportPage.tsx'), 'utf8');

describe('CashflowExportPage authoritative export surface', () => {
  it('downloads the selected range through the BFF only', () => {
    expect(source).toContain('exportCashflowWorkbookViaBff');
    expect(source).toContain('startYearMonth: yearMonths[0]');
    expect(source).toContain('endYearMonth: yearMonths[yearMonths.length - 1]');
    expect(source).toContain('BFF 서버의 최신 현금흐름 데이터');
    expect(source).not.toContain('buildCashflowExportWorkbookSpec');
    expect(source).not.toContain('loadExcelJs');
    expect(source).toContain('projectIds: scope === \'selected\'');
  });

  it('wires organization, multi-project, multi-account-type, sorting, and continuous years to the BFF', () => {
    expect(source).toContain('소속(CIC/센터)');
    expect(source).toContain('selectedProjectIds');
    expect(source).toContain('사업 다중선택');
    expect(source).toContain('통장 유형 다중선택');
    expect(source).toContain('buildCashflowExportAvailableYears');
    expect(source).not.toContain("years.add('2024')");
    expect(source).toContain("projectIds: scope === 'selected'");
    expect(source).toContain('scope,');
    expect(source).toContain("department: departmentFilter === 'ALL'");
    expect(source).toContain('accountTypes:');
    expect(source).toContain('sortBy,');
  });

  it('shows the selected project status table without client-side financial differences', () => {
    expect(source).toContain('buildCashflowExportProjectRows');
    expect(source).toContain('weeksLoading');
    expect(source).toContain('weeksLoadError');
    expect(source).toContain('Projection-Actual');
    expect(source).not.toContain('projectionActualInDifference');
    expect(source).not.toContain('projectionActualOutDifference');
    expect(source).toContain('최근 업데이트');
    expect(source).toContain('사업 보기');
    expect(source).toContain('CashflowCanonicalSummary');
    expect(source).toContain('누적 Projection-Actual');
    expect(source).not.toContain('현재 주차 상세');
    expect(source).toContain('onRetry={() => void canonicalSummaries.retry(row.id)}');
  });

  it('does not infer export readiness from the legacy weekly status collection', () => {
    expect(source).not.toContain('weeklySubmissionStatus');
    expect(source).not.toContain('onSnapshot');
    expect(source).not.toContain('업데이트된 사업');
    expect(source).not.toContain('미업데이트 사업');
    expect(source).not.toContain('최근 업데이트(Projection)');
  });
});
