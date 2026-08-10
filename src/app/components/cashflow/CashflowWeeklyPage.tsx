import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchCashflowWeeklyOverviewViaBff,
  transitionCashflowSettlementStatusViaBff,
  type CashflowProjectionActualSummary,
  type CashflowSettlementPeriod,
  type CashflowSettlementStatus,
  type CashflowSettlementStatusItem,
  type CashflowSettlementStatusesResult,
  type CashflowWeeklyOverviewResult,
} from '../../lib/platform-bff-client';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { getProjectRegistrationCicOptions, normalizeProjectDepartment } from '../../platform/project-cic';
import { recordDevtoolsLog, toDevtoolsError } from '../../platform/devtools-transaction-log';
import type { OrgMember, Project } from '../../data/types';

export function filterCashflowProjectsByDepartment<T extends { department?: unknown }>(projects: T[], department: string): T[] {
  return projects.filter((project) => department === 'ALL' || normalizeProjectDepartment(project.department) === department);
}

type SettlementStatusFilter = 'ALL' | CashflowSettlementStatus;

export function formatCashflowProjectOwner(project: Pick<Project, 'executiveApproverId' | 'executiveApproverName' | 'managerName'>, members: Array<Pick<OrgMember, 'uid' | 'name' | 'nameKo'>>) {
  const rosterOwner = members.find((member) => member.uid === project.executiveApproverId);
  const ownerName = String(rosterOwner?.nameKo || rosterOwner?.name || project.executiveApproverName || '').trim();
  const managerName = String(project.managerName || '').trim();
  return [...new Set([ownerName, managerName].filter(Boolean))].join(' · ') || '-';
}

export function filterCashflowProjectsBySettlementStatus<T extends { id: string; department?: unknown }>(
  projects: T[],
  department: string,
  statuses: Record<string, CashflowSettlementStatusesResult>,
  statusErrors: Record<string, string>,
  statusesLoading: boolean,
  weekNos: number[],
  monthStatusFilter: SettlementStatusFilter,
  weekStatusFilter: SettlementStatusFilter,
): T[] {
  return filterCashflowProjectsByDepartment(projects, department).filter((project) => {
    const projectStatuses = statuses[project.id];
    if (statusErrors[project.id] || (statusesLoading && !projectStatuses)) return true;
    const matches = (period: CashflowSettlementPeriod, filter: SettlementStatusFilter) => (
      filter === 'ALL' || (statusItem(projectStatuses, period)?.status || 'WAITING_FOR_UPDATE') === filter
    );
    return matches('MONTH', monthStatusFilter)
      && (weekStatusFilter === 'ALL' || weekNos.some((weekNo) => matches(`WEEK_${weekNo}` as CashflowSettlementPeriod, weekStatusFilter)));
  });
}

function statusItem(result: CashflowSettlementStatusesResult | undefined, period: CashflowSettlementPeriod) {
  return result?.items.find((item) => item.period === period);
}

function SettlementStatusButton({
  item,
  period,
  loading,
  canApprove,
  onAction,
}: {
  item?: CashflowSettlementStatusItem;
  period: CashflowSettlementPeriod;
  loading: boolean;
  canApprove: boolean;
  onAction: (action: 'SUBMIT' | 'APPROVE') => void;
}) {
  const status = item?.status || 'WAITING_FOR_UPDATE';
  if (status === 'COMPLETED') {
    return <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />승인 완료</span>;
  }
  if (status === 'WAITING_FOR_UPDATE') {
    return <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 font-semibold text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />{period === 'MONTH' ? '결산 전' : '주정산 이전'}</span>;
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="min-h-8 gap-1.5 whitespace-normal rounded-full border-amber-200 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
      disabled={loading || !canApprove}
      onClick={() => onAction('APPROVE')}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
      {loading ? '처리 중…' : '조직장 승인 필요'}
    </Button>
  );
}

function SettlementStatusFilterSelect({
  label,
  period,
  value,
  onValueChange,
}: {
  label: string;
  period: CashflowSettlementPeriod;
  value: SettlementStatusFilter;
  onValueChange: (value: SettlementStatusFilter) => void;
}) {
  return (
    <div className="w-[140px]">
      <Label className="mb-1.5 block text-[11px] font-semibold text-slate-600">{label}</Label>
      <Select value={value} onValueChange={(next) => onValueChange(next as SettlementStatusFilter)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">전체 상태</SelectItem>
          <SelectItem value="WAITING_FOR_UPDATE">{period === 'MONTH' ? '결산 전' : '주정산 이전'}</SelectItem>
          <SelectItem value="PENDING_APPROVAL">조직장 승인 필요</SelectItem>
          <SelectItem value="COMPLETED">승인 완료</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function PeriodAmounts({
  summary,
  period,
  loading,
  error,
}: {
  summary: CashflowProjectionActualSummary | undefined;
  period: CashflowSettlementPeriod;
  loading?: boolean;
  error?: boolean;
}) {
  if (error) return <div className="mt-1 text-[9px] text-amber-700">금액 확인 필요</div>;
  if (loading) return <div className="mt-1 text-[9px] text-slate-400">금액 확인 중…</div>;
  const amounts = summary?.periods.find((item) => item.period === period);
  if (!amounts) return null;
  return (
    <div className="mt-1 space-y-0.5 text-[9px] leading-tight text-slate-500 tabular-nums">
      <div>P {amounts.projectionAmount.toLocaleString('ko-KR')}원 · A {amounts.actualAmount.toLocaleString('ko-KR')}원</div>
      <div className="font-semibold text-slate-700">P-A {amounts.projectionActualDifferenceAmount.toLocaleString('ko-KR')}원</div>
    </div>
  );
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects, members } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { yearMonth, isLoading, goPrevMonth, goNextMonth } = useCashflowWeeks();
  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const [overview, setOverview] = useState<CashflowWeeklyOverviewResult | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [actionKey, setActionKey] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [monthStatusFilter, setMonthStatusFilter] = useState<SettlementStatusFilter>('ALL');
  const [weekStatusFilter, setWeekStatusFilter] = useState<SettlementStatusFilter>('ALL');
  const departments = useMemo(() => Array.from(new Set([
    ...getProjectRegistrationCicOptions(),
    ...projects.map((project) => normalizeProjectDepartment(project.department)).filter(Boolean),
  ])).sort((left, right) => left.localeCompare(right, 'ko')), [projects]);
  const departmentProjects = useMemo(() => filterCashflowProjectsByDepartment(projects, deptFilter), [deptFilter, projects]);
  const overviewProjectIds = useMemo(() => departmentProjects.map((project) => project.id), [departmentProjects]);
  const overviewProjectIdsKey = useMemo(() => JSON.stringify(overviewProjectIds), [overviewProjectIds]);
  const statuses = useMemo<Record<string, CashflowSettlementStatusesResult>>(() => Object.fromEntries(
    (overview?.items || []).flatMap((item) => item.settlementStatuses ? [[item.projectId, item.settlementStatuses]] : []),
  ), [overview]);
  const statusErrors = useMemo<Record<string, string>>(() => {
    if (overviewError) return Object.fromEntries(overviewProjectIds.map((projectId) => [projectId, overviewError]));
    return Object.fromEntries((overview?.errors || [])
      .filter((error) => error.code === 'STATUS_UNAVAILABLE')
      .map((error) => [error.projectId, '결산 상태를 불러오지 못했습니다. 다시 불러와 주세요.']));
  }, [overview, overviewError, overviewProjectIds]);
  const summaries = useMemo<Record<string, CashflowProjectionActualSummary>>(() => Object.fromEntries(
    (overview?.items || []).flatMap((item) => item.projectionActualSummary ? [[item.projectId, item.projectionActualSummary]] : []),
  ), [overview]);
  const summaryErrors = useMemo<Record<string, boolean>>(() => {
    if (overviewError) return Object.fromEntries(overviewProjectIds.map((projectId) => [projectId, true]));
    return Object.fromEntries((overview?.errors || [])
      .filter((error) => error.code === 'SUMMARY_UNAVAILABLE')
      .map((error) => [error.projectId, true]));
  }, [overview, overviewError, overviewProjectIds]);
  const filteredProjects = useMemo(() => filterCashflowProjectsBySettlementStatus(
    projects,
    deptFilter,
    statuses,
    statusErrors,
    overviewLoading,
    monthWeeks.map((week) => week.weekNo),
    monthStatusFilter,
    weekStatusFilter,
  ), [deptFilter, monthStatusFilter, monthWeeks, overviewLoading, projects, statusErrors, statuses, weekStatusFilter]);

  useEffect(() => {
    const projectIds = JSON.parse(overviewProjectIdsKey) as string[];
    if (!user?.idToken || projectIds.length === 0) {
      setOverview(null);
      setOverviewLoading(false);
      setOverviewError('');
      return;
    }
    let active = true;
    const startedAt = Date.now();
    setOverviewLoading(true);
    setOverviewError('');
    setOverview(null);
    recordDevtoolsLog({
      kind: 'cashflow_transaction',
      phase: 'start',
      operation: 'cashflow.weekly_overview',
      transport: 'bff',
      yearMonth,
      summary: { projectCount: projectIds.length },
    });
    void fetchCashflowWeeklyOverviewViaBff({
      tenantId: orgId,
      actor: user,
      projectIds,
      yearMonth,
    }).then((result) => {
      if (!active) return;
      setOverview(result);
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'success',
        operation: 'cashflow.weekly_overview',
        transport: 'bff',
        yearMonth,
        durationMs: Date.now() - startedAt,
        summary: { projectCount: projectIds.length, itemCount: result.items.length, issueCount: result.errors.length },
      });
    }).catch((error) => {
      if (!active) return;
      setOverviewError('현금흐름 현황을 불러오지 못했습니다. 다시 불러와 주세요.');
      recordDevtoolsLog({
        kind: 'cashflow_transaction',
        phase: 'error',
        operation: 'cashflow.weekly_overview',
        transport: 'bff',
        yearMonth,
        durationMs: Date.now() - startedAt,
        summary: { projectCount: projectIds.length },
        error: toDevtoolsError(error),
      });
    }).finally(() => {
      if (active) setOverviewLoading(false);
    });
    return () => { active = false; };
  }, [orgId, overviewProjectIdsKey, refreshSequence, user, yearMonth]);

  async function transition(projectId: string, period: CashflowSettlementPeriod, action: 'SUBMIT' | 'APPROVE') {
    if (!user?.idToken) return;
    const key = `${projectId}:${period}`;
    setActionKey(key);
    try {
      await transitionCashflowSettlementStatusViaBff({ tenantId: orgId, actor: user, projectId, yearMonth, period, action });
      setRefreshSequence((current) => current + 1);
      toast.success(action === 'APPROVE' ? '정산을 승인했습니다.' : '조직장 승인 대기로 변경했습니다.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '결산 상태를 변경하지 못했습니다.');
    } finally {
      setActionKey('');
    }
  }

  function openProject(projectId: string) {
    navigate(`/cashflow/projects/${projectId}?ym=${encodeURIComponent(yearMonth)}&view=compare#projection-actual-comparison`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)"
        title="전사 현금흐름 현황"
        description={`프로젝트별 월·주 정산 상태 · ${yearMonth}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={goPrevMonth}>
              <ChevronLeft className="h-3.5 w-3.5" /> 이전 달
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={goNextMonth}>
              다음 달 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setRefreshSequence((current) => current + 1)}>
              다시 불러오기
            </Button>
          </div>
        )}
      />

      <div className="flex items-end gap-3 rounded-lg border bg-white px-4 py-3">
        <div className="w-[180px]">
          <Label className="mb-1.5 block text-[11px] font-semibold text-slate-600">담당조직</Label>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 조직</SelectItem>
              {departments.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SettlementStatusFilterSelect label="월결산 상태" period="MONTH" value={monthStatusFilter} onValueChange={setMonthStatusFilter} />
        <SettlementStatusFilterSelect label="주정산 상태" period="WEEK_1" value={weekStatusFilter} onValueChange={setWeekStatusFilter} />
        <span className="pb-2 text-[11px] text-muted-foreground">{filteredProjects.length}개 프로젝트</span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {overviewError ? <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-900">{overviewError}</div> : null}
          <div className="max-h-[calc(100vh-190px)] overflow-auto">
            <table className="w-full min-w-[1320px] border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="bg-muted/30">
                  <th className="sticky left-0 top-0 z-40 min-w-[220px] border-b bg-slate-50 px-4 py-2 text-left font-bold">프로젝트</th>
                  <th className="sticky left-[220px] top-0 z-40 min-w-[120px] border-b bg-slate-50 px-3 py-2 text-left font-bold">담당자</th>
                  <th className="sticky top-0 z-30 min-w-[150px] border-b bg-slate-50 px-3 py-2 text-center font-bold">월 결산</th>
                  <th className="sticky top-0 z-30 min-w-[140px] border-b bg-slate-50 px-3 py-2 text-center font-bold">현금흐름(링크)</th>
                  {monthWeeks.map((week) => (
                    <th key={week.weekNo} className="sticky top-0 z-30 min-w-[170px] border-b bg-slate-50 px-3 py-2 text-center font-bold">
                      <div>{week.label}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{week.weekStart}~{week.weekEnd}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredProjects.map((project) => {
                  const projectStatuses = statuses[project.id];
                  const canApprove = user?.uid === project.executiveApproverId;
                  return (
                    <tr key={project.id} className="border-t border-border/30 transition-colors hover:bg-muted/20">
                      <td className="sticky left-0 z-20 bg-white px-4 py-3">
                        <p className="truncate font-semibold">{project.name}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{project.department} · {project.clientOrg}</p>
                      </td>
                      <td className="sticky left-[220px] z-20 bg-white px-3 py-3 font-medium">{formatCashflowProjectOwner(project, members)}</td>
                      <td className="px-3 py-3 text-center">
                        {statusErrors[project.id] ? <span className="text-amber-700">정보 확인 필요</span> : (overviewLoading && !projectStatuses) ? <span className="text-muted-foreground">확인 중…</span> : (
                          <SettlementStatusButton
                            item={statusItem(projectStatuses, 'MONTH')}
                            period="MONTH"
                            loading={actionKey === `${project.id}:MONTH`}
                            canApprove={canApprove}
                            onAction={(action) => void transition(project.id, 'MONTH', action)}
                          />
                        )}
                        <PeriodAmounts summary={summaries[project.id]} period="MONTH" loading={overviewLoading && !summaries[project.id]} error={summaryErrors[project.id]} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" onClick={() => openProject(project.id)}>
                          <ExternalLink className="h-3.5 w-3.5" /> 현금흐름 보기
                        </Button>
                      </td>
                      {monthWeeks.map((week) => {
                        const period = `WEEK_${week.weekNo}` as CashflowSettlementPeriod;
                        return (
                          <td key={week.weekNo} className="px-3 py-3 text-center">
                            {statusErrors[project.id] ? <span className="text-amber-700">정보 확인 필요</span> : (overviewLoading && !projectStatuses) ? <span className="text-muted-foreground">확인 중…</span> : (
                              <SettlementStatusButton
                                item={statusItem(projectStatuses, period)}
                                period={period}
                                loading={actionKey === `${project.id}:${period}`}
                                canApprove={canApprove}
                                onAction={(action) => void transition(project.id, period, action)}
                              />
                            )}
                            <PeriodAmounts summary={summaries[project.id]} period={period} loading={overviewLoading && !summaries[project.id]} error={summaryErrors[project.id]} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {filteredProjects.length === 0 ? (
                  <tr><td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={4 + monthWeeks.length}>프로젝트가 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {isLoading ? <div className="border-t border-border/40 px-4 py-3 text-[11px] text-muted-foreground">불러오는 중…</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
