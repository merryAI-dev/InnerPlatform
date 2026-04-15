import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  BarChart3,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
} from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { PageHeader } from '../layout/PageHeader';
import { SystemHealthPanel, ActivityFeed } from './SystemHealthPanel';
import { AdminMonitoringQueue } from './AdminMonitoringQueue';
import { computeMemberSummaries } from '../../data/participation-data';
import { useAppStore } from '../../data/store';
import { useHrAnnouncements } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { buildDashboardCashflowRollups } from './dashboard-rollups';
import { getSeoulTodayIso } from '../../platform/business-days';
import { findWeekForDate, getMonthMondayWeeks } from '../../platform/cashflow-weeks';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { isPayrollLiquidityRiskStatus, resolvePayrollLiquidityQueue } from '../../platform/payroll-liquidity';
import { resolveAdminMonitoringIssues } from '../../platform/admin-monitoring';

function MonitoringToolCard(props: {
  icon: typeof BarChart3;
  label: string;
  detail: string;
  count: number;
  countLabel: string;
  accentClass: string;
  onOpen: () => void;
}) {
  const Icon = props.icon;

  return (
    <Card className="overflow-hidden border-border/50 shadow-sm">
      <CardContent className="p-0">
        <button
          type="button"
          onClick={props.onOpen}
          className="block w-full p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground" style={{ fontWeight: 500 }}>{props.label}</p>
              <p className="mt-0.5 text-[21px] tracking-[-0.03em]" style={{ fontWeight: 800, lineHeight: 1.1 }}>
                {props.count}
                <span className="ml-1 text-[10px] text-muted-foreground" style={{ fontWeight: 600 }}>
                  {props.countLabel}
                </span>
              </p>
              <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{props.detail}</p>
            </div>
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${props.accentClass}`}>
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-primary">
            열기 <ArrowRight className="h-3 w-3" />
          </div>
        </button>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { projects, transactions, participationEntries, dataSource } = useAppStore();
  const { announcements } = useHrAnnouncements();
  const { runs } = usePayroll();
  const { weeks: cashflowWeeks } = useCashflowWeeks();
  const navigate = useNavigate();

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);

  const unresolvedHrCount = useMemo(
    () => announcements.filter((announcement) => !announcement.resolved).length,
    [announcements],
  );

  const participationRiskCount = useMemo(() => {
    const summaries = computeMemberSummaries(participationEntries);
    return summaries.filter((member) => member.riskLevel === 'DANGER').length;
  }, [participationEntries]);

  const missingEvidenceCount = useMemo(
    () => transactions.filter((tx) => tx.evidenceStatus !== 'COMPLETE' && tx.state !== 'REJECTED').length,
    [transactions],
  );

  const pendingApprovalCount = useMemo(
    () => transactions.filter((tx) => tx.state === 'SUBMITTED').length,
    [transactions],
  );

  const rejectedTransactionCount = useMemo(
    () => transactions.filter((tx) => tx.state === 'REJECTED').length,
    [transactions],
  );

  const payrollRiskCount = useMemo(() => (
    resolvePayrollLiquidityQueue({
      projects,
      runs,
      transactions,
      today,
    }).filter((item) => isPayrollLiquidityRiskStatus(item.status)).length
  ), [projects, runs, transactions, today]);

  const missingPmCount = useMemo(() => {
    const monthWeeks = getMonthMondayWeeks(yearMonth);
    const currentWeek = findWeekForDate(today, monthWeeks);
    if (!currentWeek) return 0;

    const activeProjectIds = projects
      .filter((project) => project.phase === 'CONFIRMED' && project.status === 'IN_PROGRESS')
      .map((project) => project.id);
    if (activeProjectIds.length === 0) return 0;

    const txProjectIds = new Set(
      transactions
        .filter((tx) => tx.dateTime >= currentWeek.weekStart && tx.dateTime <= currentWeek.weekEnd)
        .map((tx) => tx.projectId),
    );
    const sheetProjectIds = new Set(
      cashflowWeeks
        .filter((week) => week.yearMonth === yearMonth && week.weekNo === currentWeek.weekNo)
        .map((week) => week.projectId),
    );

    return activeProjectIds.filter((projectId) => !txProjectIds.has(projectId) && !sheetProjectIds.has(projectId)).length;
  }, [cashflowWeeks, projects, transactions, today, yearMonth]);

  const staleProjectCount = useMemo(() => {
    const cutoffMs = Date.parse(today) - (45 * 24 * 60 * 60 * 1000);
    return projects.filter((project) => {
      if (project.phase !== 'CONFIRMED' || project.status !== 'IN_PROGRESS') return false;
      const updatedAt = Date.parse(project.updatedAt || '');
      return Number.isFinite(updatedAt) && updatedAt < cutoffMs;
    }).length;
  }, [projects, today]);

  const cashflowVarianceCount = useMemo(() => (
    buildDashboardCashflowRollups({
      projects,
      transactions,
      cashflowWeeks,
      yearMonth,
    }).summary.varianceProjectCount
  ), [cashflowWeeks, projects, transactions, yearMonth]);

  const monitoringIssues = useMemo(() => resolveAdminMonitoringIssues({
    dataSourceHealthy: dataSource === 'firestore',
    missingEvidenceCount,
    payrollRiskCount,
    participationRiskCount,
    pendingApprovalCount,
    rejectedTransactionCount,
    hrAlertCount: unresolvedHrCount,
    missingPmCount,
    cashflowVarianceCount,
    staleProjectCount,
  }), [
    cashflowVarianceCount,
    dataSource,
    missingEvidenceCount,
    missingPmCount,
    participationRiskCount,
    payrollRiskCount,
    pendingApprovalCount,
    rejectedTransactionCount,
    staleProjectCount,
    unresolvedHrCount,
  ]);

  const toolCards = [
    {
      key: 'cashflow',
      label: '캐시플로 관제',
      detail: `당월 편차 ${cashflowVarianceCount} · 미입력 PM ${missingPmCount}`,
      count: cashflowVarianceCount + missingPmCount,
      countLabel: '이상',
      to: '/cashflow',
      accentClass: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
      icon: BarChart3,
    },
    {
      key: 'evidence',
      label: '증빙 큐',
      detail: `누락 ${missingEvidenceCount}건`,
      count: missingEvidenceCount,
      countLabel: '건',
      to: '/evidence',
      accentClass: 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
      icon: FileText,
    },
    {
      key: 'approvals',
      label: '승인 큐',
      detail: `대기 ${pendingApprovalCount}건 · 반려 ${rejectedTransactionCount}건`,
      count: pendingApprovalCount,
      countLabel: '건',
      to: '/approvals',
      accentClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
      icon: Clock,
    },
    {
      key: 'projects',
      label: '프로젝트 정리',
      detail: `갱신 지연 ${staleProjectCount}개 · 위험 사업은 상세 화면에서 추적`,
      count: staleProjectCount,
      countLabel: '개',
      to: '/projects',
      accentClass: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
      icon: FolderKanban,
    },
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LayoutDashboard}
        iconGradient="linear-gradient(135deg, #4f46e5, #7c3aed)"
        title="사업 통합 대시보드"
        description={`전사 사업관리 현황 모니터링 · ${projects.length}개 사업 추적 중`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate('/cashflow')}
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg text-[11px]"
            >
              캐시플로 추출 <ArrowRight className="h-3 w-3" />
            </Button>
            <Button
              onClick={() => navigate('/projects')}
              size="sm"
              className="h-8 gap-1.5 rounded-lg text-[11px]"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
            >
              전체 프로젝트 <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <AdminMonitoringQueue issues={monitoringIssues} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-5">
          {toolCards.map((card) => (
            <MonitoringToolCard
              key={card.key}
              icon={card.icon}
              label={card.label}
              detail={card.detail}
              count={card.count}
              countLabel={card.countLabel}
              accentClass={card.accentClass}
              onOpen={() => navigate(card.to)}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <SystemHealthPanel />
        </div>
        <div className="lg:col-span-4">
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
