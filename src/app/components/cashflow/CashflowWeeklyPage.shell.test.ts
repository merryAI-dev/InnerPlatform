import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterCashflowProjectsByDepartment,
  filterCashflowProjectsBySettlementStatus,
  formatCashflowExecutiveApprover,
  formatCashflowManager,
} from './CashflowWeeklyPage';
import type { PersonRecord } from '../../lib/platform-bff-client';

const source = readFileSync(resolve(import.meta.dirname, 'CashflowWeeklyPage.tsx'), 'utf8');

describe('CashflowWeeklyPage settlement status surface', () => {
  it('shows the selected-month close and weekly status columns without cashflow amounts', () => {
    expect(source).toContain('title="전사 현금흐름 현황"');
    expect(source).toContain('{Number(yearMonth.slice(5, 7))}월 결산');
    expect(source).toContain('조직장</th>');
    expect(source).toContain('책임자</th>');
    expect(source).toContain("border-l-2 border-slate-300");
    expect(source).toContain('>현금흐름(링크)</th>');
    expect(source).toContain('<div>{week.label}</div>');
    expect(source).not.toContain('>요약<');
    expect(source).not.toContain('Projection-Actual 차이');
    expect(source).not.toContain('dashboard.waiting');
    expect(source).not.toContain('dashboard.projection');
    expect(source).not.toContain("['P - A'");
    expect(source).not.toContain('금액 조회 오류');
    expect(source).not.toContain('>조회 오류</span>');
    expect(source).not.toContain('monthCloseTargetLabel');
    expect(source).toContain('실무자 결재:');
    expect(source).toContain('조직장 승인:');
    expect(source).not.toContain('PeriodAmounts');
  });

  it('uses one overview snapshot and refreshes it after a status transition', () => {
    expect(source).toContain('sticky top-0');
    expect(source).toContain('sticky left-0');
    expect(source).toContain('fetchCashflowWeeklyOverviewViaBff');
    expect(source).toContain('transitionCashflowSettlementStatusViaBff');
    expect(source).toContain("onAction={(action) => void transition(project.id, 'MONTH', action)}");
    // 2026-08-20: 진행 바로 바꿨다가 헷갈린다는 피드백으로 배지로 롤백. 기간 줄만 유지.
    expect(source).toContain('주정산 이전');
    expect(source).toContain('결산 전');
    expect(source).toContain('조직장 승인 필요');
    expect(source).toContain('승인 완료');
    expect(source).toContain('<ProjectPeriodLine start={project.contractStart} end={project.contractEnd} />');
    expect(source).not.toContain('CashflowScheduleBarCompact');
    expect(source).toContain("user?.uid === project.executiveApproverId");
    expect(source).toContain('setRefreshSequence((current) => current + 1)');
    expect(source).not.toContain('fetchCashflowSettlementStatusesBatchViaBff');
    expect(source).not.toContain('useCashflowProjectionActualSummaries');
    expect(source).not.toContain('window.setInterval');
    expect(source).not.toContain('window.location.reload');
    expect(source).not.toContain("onAction('SUBMIT')");
    expect(source).not.toContain('{project.department} · {project.clientOrg}');
  });

  it('filters both visible rows and compliance requests by normalized department', () => {
    expect(source).toContain("const [deptFilter, setDeptFilter] = useState('ALL')");
    expect(source).toContain('getProjectRegistrationCicOptions()');
    expect(source).toContain('normalizeProjectDepartment(project.department)');
    expect(source).toContain('filterCashflowProjectsByDepartment(projects, deptFilter)');
    expect(source).not.toContain('Promise.allSettled(filteredProjects.map');
    expect(source).toContain('const projectIds = JSON.parse(overviewProjectIdsKey) as string[]');
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

  it('keeps the executive approver and manager in separate columns', () => {
    const people: Array<Pick<PersonRecord, 'uid' | 'name' | 'nickname' | 'email'>> = [{ uid: 'owner-1', name: '원장 책임자', nickname: '원장', email: 'owner@example.com' }];
    expect(formatCashflowExecutiveApprover({ executiveApproverId: 'owner-1', executiveApproverName: '저장 책임자' }, people)).toBe('원장 책임자(원장)');
    expect(formatCashflowManager({ managerId: 'owner-1', managerName: '기존 담당자' }, people)).toBe('원장 책임자(원장)');
    expect(formatCashflowExecutiveApprover({ executiveApproverId: 'missing', executiveApproverName: '스냅샷 책임자' }, people)).toBe('연결 필요');
    expect(formatCashflowManager({ managerId: 'missing', managerName: '기존 담당자' }, people)).toBe('연결 필요');
    expect(source).toContain('People 연결 필요');
    expect(source).toContain('레거시 이름은 표시만 하고, 선택한 People UID로만');
    expect(source).toContain('flex flex-col items-center gap-0.5 text-center');
  });

  it('ANDs department and month status filters while accepting any matching selected-month week', () => {
    const statuses = {
      match: { projectId: 'match', yearMonth: '2026-08', items: [
        { period: 'MONTH' as const, status: 'COMPLETED' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
        { period: 'WEEK_2' as const, status: 'PENDING_APPROVAL' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
      ] },
      wrongMonth: { projectId: 'wrongMonth', yearMonth: '2026-08', items: [
        { period: 'MONTH' as const, status: 'WAITING_FOR_UPDATE' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
        { period: 'WEEK_2' as const, status: 'PENDING_APPROVAL' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
      ] },
      wrongWeek: { projectId: 'wrongWeek', yearMonth: '2026-08', items: [
        { period: 'MONTH' as const, status: 'COMPLETED' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
        { period: 'WEEK_1' as const, status: 'COMPLETED' as const, submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 1 },
      ] },
    };
    const projects = [
      { id: 'match', department: 'AXR팀' },
      { id: 'wrongMonth', department: 'AXR팀' },
      { id: 'wrongWeek', department: 'AXR팀' },
      { id: 'otherDepartment', department: 'CIC2' },
      { id: 'partialError', department: 'AXR팀' },
      { id: 'loadingOnly', department: 'AXR팀' },
    ];

    expect(filterCashflowProjectsBySettlementStatus(projects, 'AXR팀', statuses, { partialError: 'STATUS_UNAVAILABLE' }, false, [1, 2, 3, 4, 5], 'COMPLETED', 'PENDING_APPROVAL').map(({ id }) => id))
      .toEqual(['match', 'partialError']);
    expect(filterCashflowProjectsBySettlementStatus(projects, 'AXR팀', statuses, {}, true, [1, 2, 3, 4, 5], 'COMPLETED', 'PENDING_APPROVAL').map(({ id }) => id))
      .toEqual(['match', 'partialError', 'loadingOnly']);
    expect(filterCashflowProjectsBySettlementStatus([{ id: 'unset', department: 'AXR팀' }], 'AXR팀', {}, {}, false, [1], 'WAITING_FOR_UPDATE', 'WAITING_FOR_UPDATE').map(({ id }) => id))
      .toEqual(['unset']);
  });

  it('keeps the status filter labels aligned with their settlement period', () => {
    expect(source).toContain("period === 'MONTH' ? '결산 전' : '주정산 이전'");
    expect(source).toContain('조직장 승인 필요');
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
