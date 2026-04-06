import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Calculator, Users, ArrowRightLeft, ArrowRight,
  TrendingUp, TrendingDown, Clock, AlertTriangle,
  CheckCircle2, CircleDollarSign,
  ArrowUpRight, ArrowDownRight, BarChart3,
  Loader2,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { PortalMissionGuide } from './PortalMissionGuide';
import { usePortalStore } from '../../data/portal-store';
import { useHrAnnouncements, HR_EVENT_LABELS, HR_EVENT_COLORS } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { TRANSACTIONS, LEDGERS } from '../../data/mock-data';
import { fmtKRW, fmtShort } from '../../data/budget-data';
import {
  PROJECT_STATUS_LABELS, SETTLEMENT_TYPE_SHORT, BASIS_LABELS,
  type Ledger,
  type Transaction,
} from '../../data/types';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { getOrgCollectionPath } from '../../lib/firebase';
import { normalizeProjectFundInputMode } from '../../data/types';
import { resolvePortalMissionProgress } from '../../platform/portal-mission-guide';
import {
  isPayrollLiquidityRiskStatus,
  resolveProjectPayrollLiquidity,
  type PayrollLiquidityQueueItem,
} from '../../platform/payroll-liquidity';

// ═══════════════════════════════════════════════════════════════
// PortalDashboard — 내 사업 현황
// ═══════════════════════════════════════════════════════════════

export function PortalDashboard() {
  const navigate = useNavigate();
  const { isLoading, portalUser, myProject, changeRequests, bankStatementRows, expenseSheetRows, weeklySubmissionStatuses } = usePortalStore();
  const { getProjectAlerts } = useHrAnnouncements();
  const { runs, monthlyCloses, acknowledgePayrollRun, acknowledgeMonthlyClose } = usePayroll();
  const { db, isOnline, orgId } = useFirebase();
  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db;

  const [liveLedgers, setLiveLedgers] = useState<Ledger[] | null>(null);
  const [liveTransactions, setLiveTransactions] = useState<Transaction[] | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">사업 데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!myProject || !portalUser) {
    return (
      <Card data-testid="portal-dashboard-blocked-state" className="border-amber-200/70 bg-gradient-to-br from-amber-50 via-white to-orange-50/70">
        <CardContent className="p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-slate-900">첫 사업 연결이 아직 끝나지 않았습니다</h1>
                <p className="text-[13px] leading-6 text-slate-600">
                  PM 포털은 배정된 사업을 기준으로 이번 주 정산, 통장내역, 예산 반영을 이어갑니다. 사업이 보이지 않으면 먼저 연결 상태를 확인하세요.
                </p>
              </div>
              <div className="grid gap-2 text-[11px] text-slate-600 sm:grid-cols-3">
                <div className="rounded-xl border bg-white/90 px-3 py-3">1. 관리자에게 내 사업 배정을 요청합니다.</div>
                <div className="rounded-xl border bg-white/90 px-3 py-3">2. 주사업을 선택하면 이번 주 미션이 자동으로 열립니다.</div>
                <div className="rounded-xl border bg-white/90 px-3 py-3">3. 연결 후 통장내역 또는 주간 사업비부터 시작합니다.</div>
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button className="gap-2" onClick={() => navigate('/portal/project-settings')}>
                사업 연결 확인하기
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => navigate('/portal/change-requests')}>
                관리자에게 요청 남기기
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  useEffect(() => {
    if (!firestoreEnabled || !db) {
      setLiveLedgers(null);
      setLiveTransactions(null);
      return;
    }

    const unsubs: Unsubscribe[] = [];

    const ledgersQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'ledgers')),
      where('projectId', '==', myProject.id),
    );
    const txQuery = query(
      collection(db, getOrgCollectionPath(orgId, 'transactions')),
      where('projectId', '==', myProject.id),
    );

    unsubs.push(
      onSnapshot(ledgersQuery, (snap) => {
        setLiveLedgers(snap.docs.map((d) => d.data() as Ledger));
      }, (err) => {
        console.error('[PortalDashboard] ledgers listen error:', err);
        toast.error('장부 데이터를 불러오지 못했습니다');
        setLiveLedgers(null);
      }),
    );

    unsubs.push(
      onSnapshot(txQuery, (snap) => {
        setLiveTransactions(snap.docs.map((d) => d.data() as Transaction));
      }, (err) => {
        console.error('[PortalDashboard] transactions listen error:', err);
        toast.error('거래 데이터를 불러오지 못했습니다');
        setLiveTransactions(null);
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [db, firestoreEnabled, orgId, myProject.id]);

  const myLedgers = (liveLedgers ?? LEDGERS).filter(l => l.projectId === myProject.id);
  const myTx = (liveTransactions ?? TRANSACTIONS).filter(t => t.projectId === myProject.id);
  const myChanges = changeRequests.filter(r => r.projectId === myProject.id);
  const missionProgress = useMemo(() => resolvePortalMissionProgress({
    fundInputMode: normalizeProjectFundInputMode(myProject.fundInputMode),
    bankStatementRowCount: bankStatementRows?.rows?.length || 0,
    expenseRowCount: expenseSheetRows?.length || 0,
    weeklySubmissionStatuses,
  }), [bankStatementRows?.rows?.length, expenseSheetRows?.length, myProject.fundInputMode, weeklySubmissionStatuses]);

  const today = getSeoulTodayIso();
  const yearMonth = today.slice(0, 7);
  const prevYearMonth = addMonthsToYearMonth(yearMonth, -1);
  const payrollRun = runs.find((r) => r.projectId === myProject.id && r.yearMonth === yearMonth) || null;
  const monthlyClosePrev = monthlyCloses.find((c) => c.projectId === myProject.id && c.yearMonth === prevYearMonth) || null;
  const hrAlerts = getProjectAlerts(myProject.id).filter((a) => !a.acknowledged);
  const needsPayrollAck = !!(payrollRun && today >= payrollRun.noticeDate && !payrollRun.acknowledged);
  const needsMonthlyCloseAck = !!(monthlyClosePrev && monthlyClosePrev.status === 'DONE' && !monthlyClosePrev.acknowledged);

  async function onAckPayroll() {
    if (!payrollRun) return;
    try {
      await acknowledgePayrollRun(payrollRun.id);
      toast.success('공지 확인이 기록되었습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '확인 처리에 실패했습니다');
    }
  }

  async function onAckMonthlyClose() {
    if (!monthlyClosePrev) return;
    try {
      await acknowledgeMonthlyClose(monthlyClosePrev.id);
      toast.success('월간 정산 확인이 기록되었습니다');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || '확인 처리에 실패했습니다');
    }
  }

  // 재무 KPI
  const totalIn = myTx.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amounts.bankAmount, 0);
  const totalOut = myTx.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amounts.bankAmount, 0);
  const balance = totalIn - totalOut;
  const burnRate = myProject.contractAmount > 0 ? totalOut / myProject.contractAmount : 0;
  const payrollQueueItems = useMemo(() => resolveProjectPayrollLiquidity({
    project: myProject,
    runs,
    transactions: myTx,
    today,
  }), [myProject, myTx, runs, today]);
  const payrollRiskItems = useMemo(
    () => payrollQueueItems.filter((item) => isPayrollLiquidityRiskStatus(item.status)),
    [payrollQueueItems],
  );
  const payrollDetail = payrollQueueItems[0] || null;

  return (
    <div className="space-y-5">
      {/* Welcome */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px]" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            안녕하세요, {portalUser.name}님
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {myProject.name}의 이번 주 운영 현황입니다. 지금 할 일: {missionProgress.currentLabel}
          </p>
        </div>
        <Badge className="text-[10px] h-5 px-2 bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
          {PROJECT_STATUS_LABELS[myProject.status]}
        </Badge>
      </div>

      {/* 중요 공지 (인건비 / 월간정산 / 퇴사·전배) */}
      {(needsPayrollAck || needsMonthlyCloseAck || hrAlerts.length > 0) && (
        <Card className="border-amber-200/60 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/10">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[12px]" style={{ fontWeight: 800 }}>중요 공지</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  인건비 지급/월간정산 확인, 인력변경(퇴사·전배 등) 관련 공지를 확인해주세요.
                </p>
              </div>
            </div>

            {needsPayrollAck && payrollRun && (
              <div className="p-3 rounded-lg bg-background border border-amber-200/50 dark:border-amber-800/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    인건비 지급 예정: {payrollRun.plannedPayDate}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    공지일: {payrollRun.noticeDate} (지급일 3영업일 전)
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-[12px] gap-1.5 shrink-0"
                  onClick={onAckPayroll}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {needsMonthlyCloseAck && monthlyClosePrev && (
              <div className="p-3 rounded-lg bg-background border border-amber-200/50 dark:border-amber-800/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>
                    월간 정산 완료 확인: {monthlyClosePrev.yearMonth}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    완료일: {monthlyClosePrev.doneAt ? new Date(monthlyClosePrev.doneAt).toLocaleDateString('ko-KR') : '-'}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="h-8 text-[12px] gap-1.5 shrink-0"
                  onClick={onAckMonthlyClose}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> 확인했습니다
                </Button>
              </div>
            )}

            {hrAlerts.length > 0 && (
              <div className="p-3 rounded-lg bg-background border border-amber-200/50 dark:border-amber-800/40">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[12px]" style={{ fontWeight: 700 }}>인사 공지 (미확인)</p>
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => navigate('/portal/change-requests')}>
                    확인하러 가기
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {hrAlerts.slice(0, 3).map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="min-w-0">
                        <span className={`text-[9px] h-4 px-1.5 inline-flex items-center rounded ${HR_EVENT_COLORS[a.eventType]}`}>
                          {HR_EVENT_LABELS[a.eventType]}
                        </span>
                        <span className="ml-2 truncate">{a.employeeName} · {a.effectiveDate}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{a.projectId}</Badge>
                    </div>
                  ))}
                  {hrAlerts.length > 3 && (
                    <p className="text-[10px] text-muted-foreground">외 {hrAlerts.length - 3}건</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <PortalPayrollQueueCard
        item={payrollDetail}
        riskItems={payrollRiskItems}
        onOpenDetail={() => navigate('/portal/payroll')}
        onOpenBankStatements={() => navigate('/portal/bank-statements')}
      />

      {/* 사업 기본 정보 */}
      <PortalMissionGuide progress={missionProgress} />

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[11px]">
            <div>
              <span className="text-muted-foreground">발주기관</span>
              <p style={{ fontWeight: 600 }} className="mt-0.5">{myProject.clientOrg || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">정산유형</span>
              <p style={{ fontWeight: 600 }} className="mt-0.5">{SETTLEMENT_TYPE_SHORT[myProject.settlementType]}</p>
            </div>
            <div>
              <span className="text-muted-foreground">정산기준</span>
              <p style={{ fontWeight: 600 }} className="mt-0.5">{BASIS_LABELS[myProject.basis]}</p>
            </div>
            <div>
              <span className="text-muted-foreground">사업비 총액</span>
              <p style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} className="mt-0.5">
                {myProject.contractAmount > 0 ? fmtShort(myProject.contractAmount) + '원' : '-'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 재무 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '총 입금', value: fmtShort(totalIn), icon: ArrowUpRight, gradient: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)', color: '#059669' },
          { label: '총 출금', value: fmtShort(totalOut), icon: ArrowDownRight, gradient: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)', color: '#e11d48' },
          { label: '잔액', value: fmtShort(balance), icon: TrendingUp, gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: '#4f46e5' },
          { label: '소진율', value: (burnRate * 100).toFixed(1) + '%', icon: BarChart3, gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#d97706' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-3 flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: k.gradient }}
              >
                <k.icon className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">{k.label}</p>
                <p className="text-[16px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k.color }}>
                  {k.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 소진율 바 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px]" style={{ fontWeight: 600 }}>예산 소진율</span>
            <span className="text-[12px]" style={{ fontWeight: 700, color: burnRate > 0.7 ? '#e11d48' : '#059669' }}>
              {(burnRate * 100).toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(burnRate * 100, 100)}%`,
                background: burnRate > 0.7 ? '#e11d48' : burnRate > 0.4 ? '#f59e0b' : '#059669',
              }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
            <span>출금: {fmtKRW(totalOut)}원</span>
            <span>총 예산: {fmtKRW(myProject.contractAmount)}원</span>
          </div>
        </CardContent>
      </Card>

      {/* 할 일 / 빠른 액션 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" />
              할 일 & 빠른 액션
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {/* 빠른 링크 */}
            <div className="pt-1 space-y-1">
              {[
                { label: '예산 편집', icon: Calculator, to: '/portal/budget', color: '#0d9488' },
                { label: '인력변경 신청하기', icon: ArrowRightLeft, to: '/portal/change-requests', color: '#7c3aed' },
                { label: '인력 현황 보기', icon: Users, to: '/portal/personnel', color: '#059669' },
              ].map(a => (
                <button
                  key={a.label}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-muted/40 transition-colors text-left"
                  onClick={() => navigate(a.to)}
                >
                  <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${a.color}12` }}>
                    <a.icon className="w-3.5 h-3.5" style={{ color: a.color }} />
                  </div>
                  <span className="text-[11px]" style={{ fontWeight: 500 }}>{a.label}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground ml-auto" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const PORTAL_PAYROLL_BADGE_STYLES: Record<PayrollLiquidityQueueItem['status'], string> = {
  insufficient_balance: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  payment_unconfirmed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  baseline_missing: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  balance_unknown: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  clear: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

function portalPayrollLabel(status: PayrollLiquidityQueueItem['status']) {
  if (status === 'insufficient_balance') return '잔액 부족 위험';
  if (status === 'payment_unconfirmed') return '지급 확인 필요';
  if (status === 'baseline_missing') return '기준 지급액 없음';
  if (status === 'balance_unknown') return '잔액 데이터 없음';
  return '이번 지급 창 안정';
}

function PortalPayrollQueueCard({
  item,
  riskItems,
  onOpenDetail,
  onOpenBankStatements,
}: {
  item: PayrollLiquidityQueueItem | null;
  riskItems: PayrollLiquidityQueueItem[];
  onOpenDetail: () => void;
  onOpenBankStatements: () => void;
}) {
  return (
    <Card data-testid="portal-payroll-liquidity-card" className="border-border/60 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-[13px]">
          <span className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CircleDollarSign className="h-4 w-4" />
            </div>
            인건비 지급 Queue
          </span>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onOpenDetail}>
            상세 보기
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!item ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-4 text-[12px] text-muted-foreground">
            활성 지급 창이 열리면 지급일 D-3부터 D+3까지 잔액 위험을 여기서 바로 확인할 수 있습니다.
          </div>
        ) : riskItems.length > 0 ? (
          riskItems.map((risk) => (
            <div key={risk.runId} className="rounded-xl border border-rose-200/60 bg-rose-50/60 px-4 py-3 dark:border-rose-900/40 dark:bg-rose-950/10">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={`text-[10px] ${PORTAL_PAYROLL_BADGE_STYLES[risk.status]}`}>
                      {portalPayrollLabel(risk.status)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      지급일 {risk.plannedPayDate}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground" style={{ fontWeight: 700 }}>
                    예상 인건비 {risk.expectedPayrollAmount !== null ? `${fmtShort(risk.expectedPayrollAmount)}원` : '-'} · 최저 잔액 {risk.worstBalance !== null ? `${fmtShort(risk.worstBalance)}원` : '-'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{risk.statusReason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" className="h-8 text-[11px] gap-1.5" onClick={onOpenBankStatements}>
                    통장내역 열기
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-[11px] gap-1.5" onClick={onOpenDetail}>
                    지급 상세
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : item.status === 'clear' ? (
          <div className="rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-4 py-4 dark:border-emerald-900/40 dark:bg-emerald-950/10">
            <p className="text-[12px] text-emerald-800 dark:text-emerald-200" style={{ fontWeight: 700 }}>
              이번 지급 창에는 바로 대응이 필요한 위험이 없습니다.
            </p>
            <p className="mt-1 text-[11px] text-emerald-700/90 dark:text-emerald-300/90">
              지급일 {item.plannedPayDate} · 예상 인건비 {item.expectedPayrollAmount !== null ? `${fmtShort(item.expectedPayrollAmount)}원` : '-'} · 현재 잔액 {item.currentBalance !== null ? `${fmtShort(item.currentBalance)}원` : '-'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/80 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/30">
            <p className="text-[12px] text-slate-800 dark:text-slate-100" style={{ fontWeight: 700 }}>
              이번 지급 창은 열렸지만 아직 판정 기준이 충분하지 않습니다.
            </p>
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              {item.statusReason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
