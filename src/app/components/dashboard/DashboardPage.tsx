import { useMemo } from 'react';
import { SystemHealthPanel, ActivityFeed } from './SystemHealthPanel';
import { computeMemberSummaries } from '../../data/participation-data';
import { WelcomeBanner } from './WelcomeBanner';
import { PageHeader } from '../layout/PageHeader';
import { useNavigate } from 'react-router';
import {
  TrendingUp, TrendingDown, ArrowRight, CircleDollarSign,
  FolderKanban, Clock, AlertTriangle, Building2,
  Landmark, PieChart, BarChart3, Sparkles, Shield,
  ArrowUpRight, Banknote, Activity, ChevronRight,
  LayoutDashboard,
  Megaphone,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer, Legend, PieChart as RPieChart, Pie, Cell,
  AreaChart, Area,
} from 'recharts';
import { useAppStore } from '../../data/store';
import { useHrAnnouncements, HR_EVENT_LABELS, HR_EVENT_COLORS } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import {
  PROJECT_STATUS_LABELS, PROJECT_TYPE_SHORT_LABELS,
  TX_STATE_LABELS,
  type ProjectType,
} from '../../data/types';
import {
  DashboardGuidePanel,
  ValidationSummaryCard,
  ProjectValidationBadge,
  UpdateReminderBadge,
  validateProject,
} from './DashboardGuide';
import { getSeoulTodayIso } from '../../platform/business-days';

function fmt(n: number) {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString();
}

function fmtFull(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function fmtPercent(n: number) {
  return (n * 100).toFixed(2) + '%';
}

const statusStyles: Record<string, { bg: string; text: string; dot: string }> = {
  CONTRACT_PENDING: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-400' },
  IN_PROGRESS: { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-400' },
  COMPLETED: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-400' },
  COMPLETED_PENDING_PAYMENT: { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-400', dot: 'bg-teal-400' },
};

const typeColors: Record<ProjectType, string> = {
  DEV_COOPERATION: '#6366f1',
  CONSULTING: '#8b5cf6',
  SPACE_BIZ: '#f59e0b',
  IMPACT_INVEST: '#10b981',
  OTHER: '#94a3b8',
};

const txStateStyles: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400' },
  SUBMITTED: { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-400' },
  APPROVED: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400' },
  REJECTED: { bg: 'bg-rose-50 dark:bg-rose-950/30', text: 'text-rose-700 dark:text-rose-400' },
};

// ── KPI Metric Card ──
function MetricCard({ icon: Icon, label, value, sub, accent, onClick }: {
  icon: any; label: string; value: string; sub: string;
  accent: string; onClick?: () => void;
}) {
  return (
    <Card
      className={`shadow-sm border-border/40 overflow-hidden group transition-all hover:shadow-md ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-0">
        <div className="p-4 relative">
          {/* Top accent line */}
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: accent }} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1" style={{ fontWeight: 500 }}>{label}</p>
              <p className="text-[22px] text-foreground" style={{ fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                {value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1.5">{sub}</p>
            </div>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent + '12' }}>
              <Icon className="w-4.5 h-4.5" style={{ color: accent }} />
            </div>
          </div>
          {onClick && (
            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Alert Strip ──
function AlertStrip({ icon: Icon, label, count, color, onClick }: {
  icon: any; label: string; count: number; color: string; onClick?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${onClick ? 'cursor-pointer hover:shadow-sm' : ''}`}
      style={{ borderColor: color + '30', background: color + '06' }}
      onClick={onClick}
    >
      <Icon className="w-4 h-4 shrink-0" style={{ color }} />
      <span className="text-[11px] flex-1" style={{ fontWeight: 500, color }}>{label}</span>
      <span className="text-[13px] px-2 py-0.5 rounded-md" style={{ fontWeight: 800, color, background: color + '14', fontVariantNumeric: 'tabular-nums' }}>
        {count}
      </span>
    </div>
  );
}

export function DashboardPage() {
  const { projects, transactions, ledgers, participationEntries } = useAppStore();
  const navigate = useNavigate();
  const { announcements, getUnacknowledgedCount: getHrUnacked } = useHrAnnouncements();
  const { runs } = usePayroll();

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);

  const payrollSummary = useMemo(() => {
    const thisMonth = runs.filter((r) => r.yearMonth === yearMonth);
    const due = thisMonth.filter((r) => today >= r.noticeDate).length;
    const unacked = thisMonth.filter((r) => today >= r.noticeDate && !r.acknowledged).length;
    const unconfirmed = thisMonth.filter((r) => today >= r.plannedPayDate && r.paidStatus !== 'CONFIRMED').length;
    return { due, unacked, unconfirmed };
  }, [runs, today, yearMonth]);

  const hrSummary = useMemo(() => {
    const unresolved = announcements.filter((a) => !a.resolved);
    const resignations = unresolved.filter((a) => a.eventType === 'RESIGNATION');
    return {
      unresolved,
      resignations,
      unackedAlerts: getHrUnacked(),
    };
  }, [announcements, getHrUnacked]);

  const participationDanger = useMemo(() => {
    const summaries = computeMemberSummaries(participationEntries);
    return summaries.filter(m => m.riskLevel === 'DANGER');
  }, [participationEntries]);

  const validations = useMemo(() => {
    return projects.map(p => {
      const hasLedger = ledgers.some(l => l.projectId === p.id);
      return validateProject(p, transactions, hasLedger);
    });
  }, [projects, transactions, ledgers]);

  const validationMap = useMemo(() => {
    const m: Record<string, typeof validations[0]> = {};
    validations.forEach(v => { m[v.projectId] = v; });
    return m;
  }, [validations]);

  const kpis = useMemo(() => {
    const confirmed = projects.filter(p => p.phase === 'CONFIRMED');
    const prospects = projects.filter(p => p.phase === 'PROSPECT');
    const totalContractAmount = confirmed.reduce((s, p) => s + p.contractAmount, 0);
    const totalBudget2026 = confirmed.reduce((s, p) => s + p.budgetCurrentYear, 0);
    const totalTaxInvoice = confirmed.reduce((s, p) => s + p.taxInvoiceAmount, 0);
    const totalProfit = confirmed.filter(p => p.profitAmount > 0).reduce((s, p) => s + p.profitAmount, 0);
    const activeProjects = confirmed.filter(p => p.status === 'IN_PROGRESS').length;
    const completedProjects = confirmed.filter(p => p.status === 'COMPLETED' || p.status === 'COMPLETED_PENDING_PAYMENT').length;
    const prospectCount = prospects.length;
    const pendingApproval = transactions.filter(t => t.state === 'SUBMITTED').length;
    const missingEvidence = transactions.filter(t => t.evidenceStatus !== 'COMPLETE' && t.state !== 'REJECTED').length;
    const rejectedTx = transactions.filter(t => t.state === 'REJECTED').length;
    const totalIn = transactions.filter(t => t.direction === 'IN' && t.state === 'APPROVED').reduce((s, t) => s + t.amounts.bankAmount, 0);
    const totalOut = transactions.filter(t => t.direction === 'OUT' && t.state === 'APPROVED').reduce((s, t) => s + t.amounts.bankAmount, 0);
    return {
      totalContractAmount, totalBudget2026, totalTaxInvoice, totalProfit,
      activeProjects, completedProjects, prospectCount,
      confirmedCount: confirmed.length,
      pendingApproval, missingEvidence, rejectedTx,
      totalIn, totalOut,
    };
  }, [projects, transactions]);

  const deptBreakdown = useMemo(() => {
    const map: Record<string, { dept: string; count: number; totalAmount: number; budget2026: number }> = {};
    projects.forEach(p => {
      const dept = p.department || '미지정';
      if (!map[dept]) map[dept] = { dept, count: 0, totalAmount: 0, budget2026: 0 };
      map[dept].count += 1;
      map[dept].totalAmount += p.contractAmount;
      map[dept].budget2026 += p.budgetCurrentYear;
    });
    return Object.values(map).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [projects]);

  const typeBreakdown = useMemo(() => {
    const map: Record<ProjectType, { type: ProjectType; count: number; amount: number }> = {} as any;
    projects.forEach(p => {
      if (!map[p.type]) map[p.type] = { type: p.type, count: 0, amount: 0 };
      map[p.type].count += 1;
      map[p.type].amount += p.contractAmount;
    });
    return Object.values(map).filter(d => d.amount > 0).sort((a, b) => b.amount - a.amount);
  }, [projects]);

  // Monthly cashflow trend (simulated from transaction dates)
  const cashflowTrend = useMemo(() => {
    const months: Record<string, { month: string; in: number; out: number }> = {};
    transactions.filter(t => t.state === 'APPROVED').forEach(t => {
      const m = t.dateTime.slice(0, 7);
      if (!months[m]) months[m] = { month: m, in: 0, out: 0 };
      if (t.direction === 'IN') months[m].in += t.amounts.bankAmount;
      else months[m].out += t.amounts.bankAmount;
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }, [transactions]);

  const recentTx = useMemo(() => {
    return [...transactions].sort((a, b) => b.dateTime.localeCompare(a.dateTime)).slice(0, 6);
  }, [transactions]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <PageHeader
        icon={LayoutDashboard}
        iconGradient="linear-gradient(135deg, #4f46e5, #7c3aed)"
        title="사업 통합 대시보드"
        description={`전사 사업관리 현황 모니터링 · ${projects.length}개 사업 추적 중`}
        actions={
          <div className="flex items-center gap-2">
            <UpdateReminderBadge />
            <Button
              onClick={() => navigate('/projects')}
              size="sm"
              className="gap-1.5 h-8 text-[11px] rounded-lg"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #6366f1)' }}
            >
              전체 프로젝트 <ArrowRight className="w-3 h-3" />
            </Button>
          </div>
        }
      />

      <WelcomeBanner />
      <DashboardGuidePanel />

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          icon={Landmark}
          label="총 사업비"
          value={fmt(kpis.totalContractAmount)}
          sub="매출부가세 포함"
          accent="#4f46e5"
        />
        <MetricCard
          icon={Banknote}
          label="2026 총사업비"
          value={fmt(kpis.totalBudget2026)}
          sub={`세금계산서: ${fmt(kpis.totalTaxInvoice)}`}
          accent="#0d9488"
        />
        <MetricCard
          icon={TrendingUp}
          label="수익금액"
          value={fmt(kpis.totalProfit)}
          sub={`평균 수익률 ${kpis.totalContractAmount > 0 ? fmtPercent(kpis.totalProfit / kpis.totalContractAmount) : '0%'}`}
          accent="#059669"
        />
        <MetricCard
          icon={FolderKanban}
          label="사업 현황"
          value={`${kpis.activeProjects}개`}
          sub={`확정 ${kpis.confirmedCount} · 예정 ${kpis.prospectCount} · 종료 ${kpis.completedProjects}`}
          accent="#7c3aed"
          onClick={() => navigate('/projects')}
        />
      </div>

      {/* Alerts Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <AlertStrip icon={Clock} label="승인 대기" count={kpis.pendingApproval} color="#d97706" />
        <AlertStrip icon={AlertTriangle} label="증빙 미완료" count={kpis.missingEvidence} color="#ea580c" />
        <AlertStrip icon={TrendingDown} label="반려 거래" count={kpis.rejectedTx} color="#e11d48" />
        <AlertStrip
          icon={Shield}
          label="참여율 위험"
          count={participationDanger.length}
          color={participationDanger.length > 0 ? '#e11d48' : '#6366f1'}
          onClick={() => navigate('/participation')}
        />
      </div>

      {/* HR + Payroll Highlights */}
      {(hrSummary.unresolved.length > 0 || payrollSummary.due > 0 || payrollSummary.unacked > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center">
                    <Megaphone className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  </div>
                  인사 공지 (홈)
                </span>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate('/hr-announcements')}>
                  관리
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>미해결 {hrSummary.unresolved.length}건</span>
                <span>·</span>
                <span>미확인 알림 {hrSummary.unackedAlerts}건</span>
              </div>

              {hrSummary.unresolved.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">현재 미해결 인사 공지가 없습니다.</p>
              ) : (
                <div className="space-y-1.5">
                  {hrSummary.unresolved.slice(0, 3).map((ann) => (
                    <div key={ann.id} className="p-2.5 rounded-lg bg-muted/30 border border-border/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] truncate" style={{ fontWeight: 700 }}>
                            {ann.employeeName} ({ann.employeeNickname})
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            적용일: {ann.effectiveDate} · 영향 사업 {ann.affectedProjectIds.length}개
                          </p>
                        </div>
                        <Badge className={`text-[9px] h-4 px-1.5 shrink-0 ${HR_EVENT_COLORS[ann.eventType]}`}>
                          {HR_EVENT_LABELS[ann.eventType]}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {hrSummary.unresolved.length > 3 && (
                    <p className="text-[10px] text-muted-foreground">외 {hrSummary.unresolved.length - 3}건</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px] flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                    <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  인건비/월간정산 (요약)
                </span>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => navigate('/payroll')}>
                  운영 보기
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-[11px] text-muted-foreground">
                기준 월: <span style={{ fontWeight: 700 }} className="text-foreground">{yearMonth}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '공지 대상', value: payrollSummary.due, color: '#4f46e5' },
                  { label: '미인지', value: payrollSummary.unacked, color: '#e11d48' },
                  { label: '미확정', value: payrollSummary.unconfirmed, color: '#d97706' },
                ].map((k) => (
                  <div key={k.label} className="p-2.5 rounded-lg bg-muted/30 border border-border/40 text-center">
                    <p className="text-[9px] text-muted-foreground">{k.label}</p>
                    <p className="text-[16px]" style={{ fontWeight: 800, color: k.value > 0 ? k.color : undefined }}>
                      {k.value}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                지급일 3영업일 전부터 PM 확인이 필요하며, 거래 자동매칭 후 Admin이 지급을 확정합니다.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Grid: Charts + Health + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Department Breakdown */}
        <Card className="lg:col-span-5 shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
                <Building2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
              조직별 사업 현황
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptBreakdown} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="dept" width={110} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <RTooltip
                    formatter={(v: number) => fmtFull(v)}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', fontSize: 11 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="totalAmount" name="총 사업비" fill="#6366f1" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="budget2026" name="2026 예산" fill="#14b8a6" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cashflow Trend */}
        <Card className="lg:col-span-4 shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              캐시플로 추이
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cashflowTrend}>
                  <defs>
                    <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tickFormatter={(v: number) => fmt(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <RTooltip
                    formatter={(v: number, name: string) => [fmtFull(v), name === 'in' ? '입금' : '출금']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', fontSize: 11 }}
                  />
                  <Area type="monotone" dataKey="in" name="in" stroke="#10b981" strokeWidth={2} fill="url(#gradIn)" />
                  <Area type="monotone" dataKey="out" name="out" stroke="#f43f5e" strokeWidth={2} fill="url(#gradOut)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* System Health */}
        <div className="lg:col-span-3">
          <SystemHealthPanel />
        </div>
      </div>

      {/* Second Row: Pie + Projects + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Type Distribution */}
        <Card className="lg:col-span-3 shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center">
                <PieChart className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              </div>
              사업유형별
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie
                    data={typeBreakdown}
                    cx="50%"
                    cy="50%"
                    outerRadius={65}
                    innerRadius={35}
                    dataKey="amount"
                    nameKey="type"
                    strokeWidth={2}
                    stroke="#ffffff"
                  >
                    {typeBreakdown.map(entry => (
                      <Cell key={entry.type} fill={typeColors[entry.type]} />
                    ))}
                  </Pie>
                  <RTooltip
                    formatter={(v: number, _: string, entry: any) => [fmtFull(v), PROJECT_TYPE_SHORT_LABELS[entry.payload.type as ProjectType]]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11 }}
                  />
                </RPieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 mt-2">
              {typeBreakdown.map(d => (
                <div key={d.type} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: typeColors[d.type] }} />
                    <span className="text-muted-foreground" style={{ fontWeight: 500 }}>{PROJECT_TYPE_SHORT_LABELS[d.type]}</span>
                    <span className="text-muted-foreground/60">{d.count}</span>
                  </div>
                  <span className="text-foreground" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(d.amount)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Projects Table */}
        <Card className="lg:col-span-6 shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px] flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center">
                  <FolderKanban className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                전체 사업
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/projects')}
                className="gap-1 h-7 text-[10px] text-primary hover:text-primary hover:bg-accent"
              >
                상세 <ArrowUpRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-[10px]">검증</TableHead>
                    <TableHead className="min-w-[150px] text-[10px]">사업명</TableHead>
                    <TableHead className="text-[10px]">상태</TableHead>
                    <TableHead className="text-right text-[10px]">사업비</TableHead>
                    <TableHead className="text-right text-[10px]">수익률</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.slice(0, 8).map(p => {
                    const st = statusStyles[p.status];
                    return (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors h-9"
                        onClick={() => navigate(`/projects/${p.id}`)}
                      >
                        <TableCell className="py-1 text-center" onClick={e => e.stopPropagation()}>
                          {validationMap[p.id] && <ProjectValidationBadge validation={validationMap[p.id]} />}
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center gap-1 text-[11px]" style={{ fontWeight: 500 }}>
                            {p.phase === 'PROSPECT' && <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />}
                            <span className="truncate max-w-[160px]">{p.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-1">
                          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] ${st?.bg || ''} ${st?.text || ''}`}>
                            <span className={`w-1 h-1 rounded-full ${st?.dot || ''}`} />
                            {PROJECT_STATUS_LABELS[p.status]}
                          </span>
                        </TableCell>
                        <TableCell className="py-1 text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.contractAmount > 0 ? fmt(p.contractAmount) : '-'}
                        </TableCell>
                        <TableCell className="py-1 text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {p.profitRate > 0 ? (
                            <span className={p.profitRate >= 0.1 ? 'text-emerald-600' : 'text-amber-600'} style={{ fontWeight: 700 }}>
                              {fmtPercent(p.profitRate)}
                            </span>
                          ) : '-'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {projects.length > 8 && (
              <div className="text-center pt-2">
                <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="text-[10px] text-indigo-600 h-7">
                  +{projects.length - 8}개 더보기
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <div className="lg:col-span-3">
          <ActivityFeed />
        </div>
      </div>

      {/* Validation + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ValidationSummaryCard validations={validations} />

        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-teal-50 dark:bg-teal-950/40 flex items-center justify-center">
                <CircleDollarSign className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              </div>
              최근 거래
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">일자</TableHead>
                  <TableHead className="text-[10px]">거래처</TableHead>
                  <TableHead className="text-right text-[10px]">금액</TableHead>
                  <TableHead className="text-[10px]">상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTx.map(t => {
                  const txSt = txStateStyles[t.state];
                  return (
                    <TableRow key={t.id} className="hover:bg-muted/50 h-9">
                      <TableCell className="py-1 text-[10px] text-muted-foreground whitespace-nowrap">{t.dateTime.slice(5)}</TableCell>
                      <TableCell className="py-1 text-[11px] max-w-[90px] truncate">{t.counterparty}</TableCell>
                      <TableCell className="py-1 text-right text-[11px] whitespace-nowrap" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        <span className={t.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'}>
                          {t.direction === 'IN' ? '+' : '-'}{fmt(t.amounts.bankAmount)}
                        </span>
                      </TableCell>
                      <TableCell className="py-1">
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] ${txSt?.bg || ''} ${txSt?.text || ''}`} style={{ fontWeight: 500 }}>
                          {TX_STATE_LABELS[t.state]}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Summary Footer */}
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          {[
            { label: '총 사업비 합계', value: fmtFull(kpis.totalContractAmount) },
            { label: '2026 총사업비', value: fmtFull(kpis.totalBudget2026) },
            { label: '세금계산서 합계', value: fmtFull(kpis.totalTaxInvoice) },
            { label: '수익금액 합계', value: fmtFull(kpis.totalProfit), color: 'text-emerald-600 dark:text-emerald-400' },
            { label: '입금/출금 누계', value: `+${fmt(kpis.totalIn)} / -${fmt(kpis.totalOut)}`, isDouble: true },
          ].map((item, i) => (
            <div key={i}>
              <p className="text-[9px] text-muted-foreground mb-0.5">{item.label}</p>
              {(item as any).isDouble ? (
                <p className="text-[12px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  <span className="text-emerald-600 dark:text-emerald-400">+{fmt(kpis.totalIn)}</span>
                  <span className="text-muted-foreground/40 mx-0.5">/</span>
                  <span className="text-rose-600 dark:text-rose-400">-{fmt(kpis.totalOut)}</span>
                </p>
              ) : (
                <p className={`text-[12px] ${(item as any).color || 'text-foreground'}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {item.value}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
