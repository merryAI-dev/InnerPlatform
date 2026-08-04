import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterCashflowProjectsByDepartment } from './CashflowWeeklyPage';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'), 'utf8');

describe('CashflowWeeklyPage settlement status surface', () => {
  it('shows the requested month and weekly status columns without the old summary', () => {
    expect(source).toContain('title="전사 현금흐름 현황"');
    expect(source).toContain('>월 결산</th>');
    expect(source).toContain('>현금흐름(링크)</th>');
    expect(source).toContain('<div>{week.weekNo}주</div>');
    expect(source).not.toContain('>요약<');
    expect(source).not.toContain('Projection-Actual 차이');
  });

  it('uses the simple persisted status flow and updates only the affected project state', () => {
    expect(source).toContain('sticky top-0');
    expect(source).toContain('sticky left-0');
    expect(source).toContain('fetchCashflowSettlementStatusesBatchViaBff');
    expect(source).toContain('transitionCashflowSettlementStatusViaBff');
    expect(source).toContain('주정산 이전');
    expect(source).toContain('결산 전');
    expect(source).toContain('조직장 승인 필요');
    expect(source).toContain('승인 완료');
    expect(source).toContain("user?.uid === project.executiveApproverId");
    expect(source).toContain("setStatuses((current) => ({ ...current, [projectId]: result }))");
    expect(source).not.toContain('window.location.reload');
    expect(source).not.toContain("onAction('SUBMIT')");
  });

  it('filters both visible rows and compliance requests by normalized department', () => {
    expect(source).toContain("const [deptFilter, setDeptFilter] = useState('ALL')");
    expect(source).toContain('getProjectRegistrationCicOptions()');
    expect(source).toContain('normalizeProjectDepartment(project.department)');
    expect(source).toContain('filterCashflowProjectsByDepartment(projects, deptFilter)');
    expect(source).not.toContain('Promise.allSettled(filteredProjects.map');
    expect(source).toContain('projectIds.slice(index * 100, (index + 1) * 100)');
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

  it('routes detailed work to the project cashflow screen', () => {
    expect(source).not.toContain('useCashflowEditLease');
    expect(source).not.toContain('updateVarianceFlag');
    expect(source).not.toContain('EditLeaseDialogs');
    expect(source).not.toContain('checkBeforeMutation');
    expect(source).toContain('&view=compare');
    expect(source).toContain('#projection-actual-comparison');
    expect(source).toContain('현금흐름 보기');
  });
});
