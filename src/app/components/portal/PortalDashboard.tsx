import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Wallet, Calculator, Users, ArrowRightLeft, ArrowRight,
  TrendingUp, TrendingDown, Clock, AlertTriangle,
  CheckCircle2, XCircle, FileText, CircleDollarSign,
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
import { usePortalStore } from '../../data/portal-store';
import { useHrAnnouncements, HR_EVENT_LABELS, HR_EVENT_COLORS } from '../../data/hr-announcements-store';
import { usePayroll } from '../../data/payroll-store';
import { TRANSACTIONS, LEDGERS } from '../../data/mock-data';
import {
  EXPENSE_STATUS_LABELS, EXPENSE_STATUS_COLORS,
  fmtKRW, fmtShort,
} from '../../data/budget-data';
import {
  PROJECT_STATUS_LABELS, SETTLEMENT_TYPE_SHORT, BASIS_LABELS,
  type Ledger,
  type Transaction,
} from '../../data/types';
import { addMonthsToYearMonth, getSeoulTodayIso } from '../../platform/business-days';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { getOrgCollectionPath } from '../../lib/firebase';

// ═══════════════════════════════════════════════════════════════
// PortalDashboard — 내 사업 현황
// ═══════════════════════════════════════════════════════════════

export function PortalDashboard() {
  const navigate = useNavigate();
  const { isLoading, portalUser, myProject, expenseSets, changeRequests } = usePortalStore();
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
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-[14px] text-muted-foreground">사업이 선택되지 않았습니다.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/portal/onboarding')}>
          사업 선택하기
        </Button>
      </div>
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
        setLiveLedgers(null);
      }),
    );

    unsubs.push(
      onSnapshot(txQuery, (snap) => {
        setLiveTransactions(snap.docs.map((d) => d.data() as Transaction));
      }, (err) => {
        console.error('[PortalDashboard] transactions listen error:', err);
        setLiveTransactions(null);
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [db, firestoreEnabled, orgId, myProject.id]);

  const myExpenses = expenseSets.filter(s => s.projectId === myProject.id);
  const myLedgers = (liveLedgers ?? LEDGERS).filter(l => l.projectId === myProject.id);
  const myTx = (liveTransactions ?? TRANSACTIONS).filter(t => t.projectId === myProject.id);
  const myChanges = changeRequests.filter(r => r.projectId === myProject.id);

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

  // 사업비 세트 KPI
  const draftSets = myExpenses.filter(s => s.status === 'DRAFT').length;
  const submittedSets = myExpenses.filter(s => s.status === 'SUBMITTED').length;
  const approvedSets = myExpenses.filter(s => s.status === 'APPROVED').length;
  const rejectedSets = myExpenses.filter(s => s.status === 'REJECTED').length;
  const totalExpenseAmount = myExpenses.reduce((s, e) => s + e.totalGross, 0);

  return (
    <div className="space-y-5">
      {/* Welcome */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px]" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>
            안녕하세요, {portalUser.name}님
          </h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {myProject.name}의 사업 관리 현황입니다
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

      {/* 사업 기본 정보 */}
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
        {/* 사업비 상태 */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[13px] flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-indigo-500" />
                사업비 현황
              </CardTitle>
              <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => navigate('/portal/expenses')}>
                관리하기 <ArrowRight className="w-3 h-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: '작성중', count: draftSets, color: '#64748b' },
                { label: '제출', count: submittedSets, color: '#3b82f6' },
                { label: '승인', count: approvedSets, color: '#059669' },
                { label: '반려', count: rejectedSets, color: '#e11d48' },
              ].map(s => (
                <div key={s.label} className="text-center p-2 rounded-lg bg-muted/30">
                  <p className="text-[16px]" style={{ fontWeight: 700, color: s.color }}>{s.count}</p>
                  <p className="text-[9px] text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {/* 최근 세트 */}
            <div className="space-y-1.5">
              {myExpenses.slice(0, 3).map(s => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => navigate('/portal/expenses')}>
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[11px] truncate">{s.title}</span>
                  </div>
                  <Badge className={`text-[9px] h-4 px-1.5 shrink-0 ${EXPENSE_STATUS_COLORS[s.status]}`}>
                    {EXPENSE_STATUS_LABELS[s.status]}
                  </Badge>
                </div>
              ))}
              {myExpenses.length === 0 && (
                <p className="text-[11px] text-muted-foreground text-center py-3">아직 사업비 세트가 없습니다</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 빠른 액션 + 인력변경 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" />
              할 일 & 빠른 액션
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {rejectedSets > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-800/40">
                <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px]" style={{ fontWeight: 600 }}>반려된 사업비 세트 {rejectedSets}건</p>
                  <p className="text-[10px] text-muted-foreground">수정 후 재제출이 필요합니다</p>
                </div>
                <Button variant="outline" size="sm" className="h-6 text-[10px] shrink-0 ml-auto" onClick={() => navigate('/portal/expenses')}>
                  확인
                </Button>
              </div>
            )}
            {draftSets > 0 && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/40">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px]" style={{ fontWeight: 600 }}>미제출 사업비 세트 {draftSets}건</p>
                  <p className="text-[10px] text-muted-foreground">작성 완료 후 제출해 주세요</p>
                </div>
              </div>
            )}

            {/* 빠른 링크 */}
            <div className="pt-1 space-y-1">
              {[
                { label: '사업비 세트 새로 만들기', icon: Wallet, to: '/portal/expenses', color: '#4f46e5' },
                { label: '예산총괄 확인', icon: Calculator, to: '/portal/budget', color: '#0d9488' },
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
