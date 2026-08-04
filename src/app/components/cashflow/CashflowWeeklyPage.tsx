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
  fetchCashflowSettlementStatusesBatchViaBff,
  transitionCashflowSettlementStatusViaBff,
  type CashflowSettlementPeriod,
  type CashflowSettlementStatusItem,
  type CashflowSettlementStatusesResult,
} from '../../lib/platform-bff-client';
import { getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { getProjectRegistrationCicOptions, normalizeProjectDepartment } from '../../platform/project-cic';

export function filterCashflowProjectsByDepartment<T extends { department?: unknown }>(projects: T[], department: string): T[] {
  return projects.filter((project) => department === 'ALL' || normalizeProjectDepartment(project.department) === department);
}

function statusItem(result: CashflowSettlementStatusesResult | undefined, period: CashflowSettlementPeriod) {
  return result?.items.find((item) => item.period === period);
}

function SettlementStatusButton({
  item,
  loading,
  canApprove,
  onAction,
}: {
  item?: CashflowSettlementStatusItem;
  loading: boolean;
  canApprove: boolean;
  onAction: (action: 'SUBMIT' | 'APPROVE') => void;
}) {
  const status = item?.status || 'WAITING_FOR_UPDATE';
  if (status === 'COMPLETED') {
    return <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />정산 완료</span>;
  }
  const action = status === 'PENDING_APPROVAL' ? 'APPROVE' : 'SUBMIT';
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={`min-h-8 gap-1.5 whitespace-normal rounded-full px-2.5 text-[11px] font-semibold ${status === 'PENDING_APPROVAL' ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
      disabled={loading || (action === 'APPROVE' && !canApprove)}
      onClick={() => onAction(action)}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'PENDING_APPROVAL' ? 'bg-amber-500' : 'bg-slate-400'}`} aria-hidden="true" />
      {loading ? '처리 중…' : status === 'PENDING_APPROVAL' ? '조직장 승인 필요' : '주정산 전'}
    </Button>
  );
}

export function CashflowWeeklyPage() {
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const { yearMonth, isLoading, goPrevMonth, goNextMonth } = useCashflowWeeks();
  const monthWeeks = useMemo(() => getMonthMondayWeeks(yearMonth), [yearMonth]);
  const [statuses, setStatuses] = useState<Record<string, CashflowSettlementStatusesResult>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({});
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [actionKey, setActionKey] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const departments = useMemo(() => Array.from(new Set([
    ...getProjectRegistrationCicOptions(),
    ...projects.map((project) => normalizeProjectDepartment(project.department)).filter(Boolean),
  ])).sort((left, right) => left.localeCompare(right, 'ko')), [projects]);
  const filteredProjects = useMemo(() => filterCashflowProjectsByDepartment(projects, deptFilter), [deptFilter, projects]);

  useEffect(() => {
    if (!user?.idToken || filteredProjects.length === 0) {
      setStatuses({});
      setStatusErrors({});
      setStatusesLoading(false);
      return;
    }
    let active = true;
    setStatusesLoading(true);
    const projectIds = filteredProjects.map((project) => project.id);
    const batches = Array.from(
      { length: Math.ceil(projectIds.length / 100) },
      (_, index) => projectIds.slice(index * 100, (index + 1) * 100),
    );
    void Promise.all(batches.map(async (batchProjectIds) => fetchCashflowSettlementStatusesBatchViaBff({
      tenantId: orgId, actor: user, projectIds: batchProjectIds, yearMonth,
    }).catch(() => ({
      items: [],
      errors: batchProjectIds.map((projectId) => ({ projectId, code: 'STATUS_UNAVAILABLE' as const })),
    })))).then((results) => {
      if (!active) return;
      const next = Object.fromEntries(results.flatMap((result) => result.items).map((item) => [item.projectId, item]));
      const errors = Object.fromEntries(results.flatMap((result) => result.errors).map((error) => [error.projectId, '결산 상태를 불러오지 못했습니다.']));
      setStatuses(next);
      setStatusErrors(errors);
      setStatusesLoading(false);
    });
    return () => { active = false; };
  }, [filteredProjects, orgId, user, yearMonth]);

  async function transition(projectId: string, period: CashflowSettlementPeriod, action: 'SUBMIT' | 'APPROVE') {
    if (!user?.idToken) return;
    const key = `${projectId}:${period}`;
    setActionKey(key);
    try {
      const result = await transitionCashflowSettlementStatusViaBff({
        tenantId: orgId, actor: user, projectId, yearMonth, period, action,
      });
      setStatuses((current) => ({ ...current, [projectId]: result }));
      setStatusErrors((current) => ({ ...current, [projectId]: '' }));
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
        <span className="pb-2 text-[11px] text-muted-foreground">{filteredProjects.length}개 프로젝트</span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
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
                      <div>{week.weekNo}주</div>
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
                      <td className="sticky left-[220px] z-20 bg-white px-3 py-3 font-medium">{project.managerName}</td>
                      <td className="px-3 py-3 text-center">
                        {statusErrors[project.id] ? <span className="text-red-700">조회 오류</span> : statusesLoading && !projectStatuses ? <span className="text-muted-foreground">확인 중…</span> : (
                          <SettlementStatusButton
                            item={statusItem(projectStatuses, 'MONTH')}
                            loading={actionKey === `${project.id}:MONTH`}
                            canApprove={canApprove}
                            onAction={(action) => void transition(project.id, 'MONTH', action)}
                          />
                        )}
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
                            {statusErrors[project.id] ? <span className="text-red-700">조회 오류</span> : statusesLoading && !projectStatuses ? <span className="text-muted-foreground">확인 중…</span> : (
                              <SettlementStatusButton
                                item={statusItem(projectStatuses, period)}
                                loading={actionKey === `${project.id}:${period}`}
                                canApprove={canApprove}
                                onAction={(action) => void transition(project.id, period, action)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {filteredProjects.length === 0 ? (
                  <tr><td className="px-4 py-8 text-center text-[12px] text-muted-foreground" colSpan={9}>프로젝트가 없습니다.</td></tr>
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
