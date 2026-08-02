import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterCashflowProjectsByDepartment,
  findCashflowWeeklyCompliance,
  isCashflowSettlementCompleted,
} from './CashflowWeeklyPage';
import type { CashflowWeeklyComplianceItem } from '../../lib/platform-bff-client';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'), 'utf8');

describe('CashflowWeeklyPage read-only status surface', () => {
  it('shows only the selected-month weekly difference in exact won', () => {
    expect(source).toContain('title="전사 현금흐름 현황"');
    expect(source).toContain('projectionTotals: week.projectionTotals || emptyTotals()');
    expect(source).toContain('actualTotals: week.actualTotals || emptyTotals()');
    expect(source).toContain('const difference = projection.net - actual.net');
    expect(source).toContain('Projection·Actual·차이');
    expect(source).not.toContain('CashflowCanonicalSummary');
    expect(source).not.toContain('누적 Projection-Actual 정산');
    expect(source).not.toContain('주차 상세');
    expect(source).toContain('Projection-Actual 차이');
    expect(source).toContain("difference.toLocaleString('ko-KR')");
    expect(source).toContain('text-[16px] font-bold');
    expect(source).not.toContain('formatKoreanWonCompact');
    expect(source).not.toContain('>Projection 순액<');
    expect(source).not.toContain('>Actual 순액<');
    expect(source).not.toContain('monthlyDifference');
  });

  it('keeps the project summary visible and uses weekly settlement completion states', () => {
    expect(source).toContain('sticky top-0');
    expect(source).toContain('sticky left-0');
    expect(source).toContain('>요약<');
    expect(source).toContain('fetchCashflowWeeklyComplianceViaBff');
    expect(source).toContain("status === 'ON_TIME' || status === 'COMPLETED_LATE'");
    expect(source).toContain("week.status === 'MISSED'");
    expect(source).toContain("'완료 대기'");
    expect(source).toContain("settlementCompleted ? '완료' : '미완료'");
    expect(source).toContain("completedSettlementCount === monthWeeks.length ? '완료' : '미완료'");
    expect(source).not.toContain('결산 완료');
    expect(source).not.toContain('D-7');
    expect(source).not.toContain('최종 확정과 수정 잠금은 프로젝트별 월 결산 승인에서 처리합니다.');
    expect(source).toContain("toLocaleString('ko-KR')");
    expect(source).toContain('limit: 50');
    expect(source).toContain('이전 이력 더 불러오기');
    expect(source).toContain('page.nextCursor === current.nextCursor');
    expect(source).not.toContain('fetchCashflowMonthCloseViaBff');
    expect(source).toContain("settlementCompleted ? 'bg-emerald-50 dark:bg-emerald-950/30'");
  });

  it('filters both visible rows and compliance requests by normalized department', () => {
    expect(source).toContain("const [deptFilter, setDeptFilter] = useState('ALL')");
    expect(source).toContain('getProjectRegistrationCicOptions()');
    expect(source).toContain('normalizeProjectDepartment(project.department)');
    expect(source).toContain('filterCashflowProjectsByDepartment(projects, deptFilter)');
    expect(source).toContain('Promise.allSettled(filteredProjects.map');
    expect(source).toContain('{filteredProjects.map((project) => {');
    expect(source).toContain('filteredProjects.length === 0');
    expect(source).toContain('>담당조직</Label>');
    expect(source).toContain('<SelectItem value="ALL">전체 조직</SelectItem>');

    const projects = [
      { id: 'axr', department: 'AXR team' },
      { id: 'cic', department: 'CIC 2' },
      { id: 'empty', department: '' },
    ];
    expect(filterCashflowProjectsByDepartment(projects, 'ALL').map(({ id }) => id)).toEqual(['axr', 'cic', 'empty']);
    expect(filterCashflowProjectsByDepartment(projects, 'AXR팀').map(({ id }) => id)).toEqual(['axr']);
    expect(filterCashflowProjectsByDepartment(projects, 'CIC2').map(({ id }) => id)).toEqual(['cic']);
    expect(filterCashflowProjectsByDepartment(projects, '없는 조직')).toEqual([]);
  });

  it('marks only the exact completed year-month and week as completed', () => {
    const compliance = (yearMonth: string, weekNo: number, status: CashflowWeeklyComplianceItem['status']): CashflowWeeklyComplianceItem => ({
      yearMonth,
      weekNo,
      status,
      deadline: '',
      completedAt: null,
      completedBy: null,
      operationId: null,
      auditId: null,
      updateResult: null,
    });
    const items = [
      compliance('2026-07', 1, 'ON_TIME'),
      compliance('2026-08', 1, 'COMPLETED_LATE'),
      compliance('2026-08', 2, 'MISSED'),
    ];

    expect(isCashflowSettlementCompleted(findCashflowWeeklyCompliance(items, '2026-08', 1)?.status)).toBe(true);
    expect(isCashflowSettlementCompleted(findCashflowWeeklyCompliance(items, '2026-08', 2)?.status)).toBe(false);
    expect(isCashflowSettlementCompleted(findCashflowWeeklyCompliance(items, '2026-08', 3)?.status)).toBe(false);
    expect(isCashflowSettlementCompleted(findCashflowWeeklyCompliance(items, '2026-07', 1)?.status)).toBe(true);
  });

  it('is read-only and routes detailed work to the project cashflow screen', () => {
    expect(source).not.toContain('useCashflowEditLease');
    expect(source).not.toContain('updateVarianceFlag');
    expect(source).not.toContain('EditLeaseDialogs');
    expect(source).not.toContain('checkBeforeMutation');
    expect(source).toContain('&view=compare');
    expect(source).toContain('#projection-actual-comparison');
    expect(source).toContain('현금흐름 보기');
  });
});
