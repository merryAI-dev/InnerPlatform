import { useState, useMemo } from 'react';
import {
  Lock, Unlock, ChevronDown, ChevronRight, Eye, EyeOff,
  Info, Calculator, Download, Printer, Clock,
  ArrowUpRight, ArrowDownRight, CreditCard, Landmark,
  SlidersHorizontal, AlertCircle, FileText, TrendingUp,
  Wallet, ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '../ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../ui/tooltip';
import { PageHeader } from '../layout/PageHeader';
import {
  BUDGET_META, BANK_INFO, BUDGET_ROWS, BUDGET_AUX_ROWS, BUDGET_TIMELINE,
  fmtKRW, fmtPercent, fmtShort,
  type BudgetRow, type BudgetTimelineEvent,
} from '../../data/budget-data';

// ═══════════════════════════════════════════════════════════════
// BudgetSummaryPage — 구글시트 "1.예산총괄시트" 재현
// ═══════════════════════════════════════════════════════════════

const GROUP_LABELS: Record<string, string> = {
  g1: '소계 1 — MYSC 인건비',
  g2: '소계 2 — 직접사업비 (프로그램 운영비)',
  g3: '소계 3 — 업무추진비',
  g4: '소계 4 — 팀지원금',
};

export function BudgetSummaryPage() {
  const [bankVisible, setBankVisible] = useState(false);
  const [bankRevealed, setBankRevealed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedRow, setSelectedRow] = useState<BudgetRow | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(true);

  const meta = BUDGET_META;
  const rows = BUDGET_ROWS;
  const auxRows = BUDGET_AUX_ROWS;
  const timeline = BUDGET_TIMELINE;

  // 그룹 접기/펼치기
  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // 표시할 행 필터링
  const visibleRows = useMemo(() => {
    return rows.filter(r => {
      if (!r.groupId) return true;
      if (r.rowType === 'SUBTOTAL') return true;
      return !collapsedGroups.has(r.groupId);
    });
  }, [rows, collapsedGroups]);

  // KPI 계산
  const kpi = useMemo(() => {
    const total = rows.find(r => r.rowType === 'TOTAL');
    if (!total) return { budget: 0, spent: 0, balance: 0, burnRate: 0 };
    return {
      budget: total.initialBudget,
      spent: total.spent,
      balance: total.balance,
      burnRate: total.burnRate,
    };
  }, [rows]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
        {/* Header */}
        <PageHeader
          icon={Calculator}
          iconGradient="linear-gradient(135deg, #0d9488 0%, #059669 100%)"
          title="예산총괄"
          description="구글시트 '1.예산총괄시트' 기반 — 예산 배정·소진·잔액 통합 관리"
          badge={meta.year + '년'}
          actions={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5">
                <Download className="w-3.5 h-3.5" />
                내보내기
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-[12px] gap-1.5">
                <Printer className="w-3.5 h-3.5" />
                인쇄
              </Button>
            </div>
          }
        />

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: '총 예산', value: fmtShort(kpi.budget), icon: Wallet, gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' },
            { label: '집행액', value: fmtShort(kpi.spent), icon: ArrowDownRight, gradient: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)' },
            { label: '잔액', value: fmtShort(kpi.balance), icon: TrendingUp, gradient: 'linear-gradient(135deg, #0d9488 0%, #059669 100%)' },
            { label: '소진율', value: fmtPercent(kpi.burnRate), icon: SlidersHorizontal, gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
          ].map(k => (
            <Card key={k.label} className="overflow-hidden">
              <CardContent className="p-3 flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: k.gradient }}
                >
                  <k.icon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">{k.label}</p>
                  <p className="text-[16px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {k.value}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Meta Info Card ── */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">연도/펀더:</span>
                <span style={{ fontWeight: 600 }}>{meta.year}년 / {meta.funder}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">정산기준:</span>
                <Badge variant="outline" className="text-[10px] h-5">{meta.basis} {meta.basisOption}</Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">사업명:</span>
                <span style={{ fontWeight: 600 }}>{meta.projectName}</span>
              </div>
              <div className="flex items-center gap-1.5 ml-auto">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">최종 업데이트: {meta.lastUpdated} ({meta.updatedBy})</span>
              </div>
            </div>

            <Separator />

            {/* Guide — 파란/빨간 의미 */}
            <div className="flex items-center gap-4 text-[11px]">
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  <Lock className="w-3 h-3" />
                  <span style={{ fontWeight: 600 }}>{meta.guide.fixedLabel}</span>
                </div>
                <span className="text-muted-foreground">= 변경 불가 항목</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                  <SlidersHorizontal className="w-3 h-3" />
                  <span style={{ fontWeight: 600 }}>{meta.guide.adjustableLabel}</span>
                </div>
                <span className="text-muted-foreground">= 예산 조정 가능</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 보안 섹션: 통장/카드 정보 ── */}
        <Card className="overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] hover:bg-muted/30 transition-colors"
            onClick={() => setBankVisible(!bankVisible)}
          >
            <div className="flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
              <span style={{ fontWeight: 600 }}>사업비 통장/카드 정보</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50">
                보안영역
              </Badge>
            </div>
            {bankVisible ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          {bankVisible && (
            <CardContent className="px-4 pb-4 pt-0">
              <div className="flex items-center gap-2 mb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] gap-1"
                  onClick={() => setBankRevealed(!bankRevealed)}
                >
                  {bankRevealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {bankRevealed ? '마스킹' : '원본 보기'}
                </Button>
                <span className="text-[10px] text-muted-foreground">권한 있는 사용자만 원본 열람 가능</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {BANK_INFO.map(b => (
                  <div key={b.label} className="p-2.5 rounded-lg bg-muted/50 border border-border/50">
                    <p className="text-[10px] text-muted-foreground mb-1">{b.label}</p>
                    <p className="text-[13px]" style={{ fontWeight: 600, fontFamily: 'monospace' }}>
                      {bankRevealed ? b.value : b.masked}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

        {/* ── 메인: 예산총괄 테이블 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center gap-2">
              <FileText className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              예산총괄 테이블
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] border-collapse min-w-[1200px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-y border-border">
                    <th className="sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10 px-3 py-2.5 text-left" style={{ fontWeight: 600, minWidth: 100 }}>사업비 구분</th>
                    <th className="sticky left-[100px] bg-slate-50 dark:bg-slate-800/50 z-10 px-3 py-2.5 text-left" style={{ fontWeight: 600, minWidth: 140 }}>비목</th>
                    <th className="sticky left-[240px] bg-slate-50 dark:bg-slate-800/50 z-10 px-3 py-2.5 text-left border-r border-border" style={{ fontWeight: 600, minWidth: 120 }}>세목</th>
                    <th className="px-3 py-2.5 text-left" style={{ fontWeight: 600, minWidth: 100 }}>산정 내역</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 110 }}>최초 승인 예산</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 110 }}>변경 예산(8월)</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 110 }}>변경 예산(10월)</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 70 }}>구성비</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 110 }}>소진금액</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 100 }}>매입부가세</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 70 }}>소진율</th>
                    <th className="px-3 py-2.5 text-right" style={{ fontWeight: 600, minWidth: 110 }}>잔액</th>
                    <th className="px-3 py-2.5 text-left" style={{ fontWeight: 600, minWidth: 200 }}>특이사항</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const isSubtotal = row.rowType === 'SUBTOTAL';
                    const isTotal = row.rowType === 'TOTAL';
                    const isSummary = isSubtotal || isTotal;
                    const isFixed = row.fixType === 'FIXED';
                    const isAdj = row.fixType === 'ADJUSTABLE';
                    const isCollapsed = row.groupId ? collapsedGroups.has(row.groupId) : false;

                    return (
                      <tr
                        key={row.id}
                        className={`
                          border-b border-border/50 transition-colors
                          ${isTotal ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}
                          ${isSubtotal ? 'bg-slate-50/80 dark:bg-slate-800/30' : ''}
                          ${!isSummary ? 'hover:bg-muted/30 cursor-pointer' : ''}
                        `}
                        style={{ fontWeight: isSummary ? 600 : 400 }}
                        onClick={() => !isSummary && setSelectedRow(row)}
                      >
                        {/* 사업비 구분 */}
                        <td className="sticky left-0 bg-card z-10 px-3 py-2">
                          <div className="flex items-center gap-1">
                            {isSubtotal && row.groupId && (
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleGroup(row.groupId!); }}
                                className="p-0.5 rounded hover:bg-muted transition-colors"
                              >
                                {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>
                            )}
                            {isTotal ? '총계' : isSubtotal ? GROUP_LABELS[row.groupId || ''] || '소계' : row.category}
                            {isFixed && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                                    <Lock className="w-2.5 h-2.5" /> 고정
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-[11px]">못 빼는 돌 — 변경 불가 항목</TooltipContent>
                              </Tooltip>
                            )}
                            {isAdj && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                                    <SlidersHorizontal className="w-2.5 h-2.5" /> 조정
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="text-[11px]">조정 가능한 큰 돌</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        {/* 비목 */}
                        <td className="sticky left-[100px] bg-card z-10 px-3 py-2">{isSummary ? '' : row.budgetCode}</td>
                        {/* 세목 */}
                        <td className="sticky left-[240px] bg-card z-10 px-3 py-2 border-r border-border/50">{isSummary ? '' : row.subCode}</td>
                        {/* 산정 내역 */}
                        <td className="px-3 py-2">{row.calcDesc}</td>
                        {/* 숫자 컬럼들 — tabular-nums */}
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(row.initialBudget)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(row.revisedAug)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(row.revisedOct)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPercent(row.composition)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', color: row.spent > 0 ? '#e11d48' : undefined }}>{fmtKRW(row.spent)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(row.vatPurchase)}</td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {row.burnRate > 0 ? (
                            <span className={row.burnRate > 0.5 ? 'text-rose-600 dark:text-rose-400' : row.burnRate > 0.25 ? 'text-amber-600 dark:text-amber-400' : ''}>
                              {fmtPercent(row.burnRate)}
                            </span>
                          ) : '0%'}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: '#059669' }}>{fmtKRW(row.balance)}</td>
                        <td className="px-3 py-2 max-w-[250px] truncate text-muted-foreground" title={row.note}>{row.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ── 하단 보조 테이블 + 타임라인 ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 보조 테이블 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[13px]">예산 구성 분석</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-y border-border">
                    <th className="px-4 py-2 text-left" style={{ fontWeight: 600 }}>항목</th>
                    <th className="px-4 py-2 text-right" style={{ fontWeight: 600 }}>금액</th>
                    <th className="px-4 py-2 text-right" style={{ fontWeight: 600 }}>구성비율</th>
                  </tr>
                </thead>
                <tbody>
                  {auxRows.map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-4 py-2">{r.label}</td>
                      <td className="px-4 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtKRW(r.amount)}</td>
                      <td className="px-4 py-2 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtPercent(r.ratio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* 거래 타임라인 */}
          <Card>
            <CardHeader className="pb-2">
              <button
                className="flex items-center justify-between w-full"
                onClick={() => setTimelineOpen(!timelineOpen)}
              >
                <CardTitle className="text-[13px] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  거래 타임라인 / 정산 메모
                </CardTitle>
                {timelineOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
              </button>
            </CardHeader>
            {timelineOpen && (
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {timeline.map(ev => (
                    <TimelineItem key={ev.id} event={ev} />
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── 행 상세 Drawer (Dialog) ── */}
        <Dialog open={!!selectedRow} onOpenChange={(open) => !open && setSelectedRow(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-[14px]">예산 항목 상세</DialogTitle>
            </DialogHeader>
            {selectedRow && <RowDetail row={selectedRow} />}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ── TimelineItem ──
function TimelineItem({ event }: { event: BudgetTimelineEvent }) {
  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
        event.direction === 'IN' ? 'bg-emerald-100 dark:bg-emerald-900/50' :
        event.direction === 'OUT' ? 'bg-rose-100 dark:bg-rose-900/50' :
        'bg-slate-100 dark:bg-slate-800'
      }`}>
        {event.direction === 'IN' ? (
          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : event.direction === 'OUT' ? (
          <ArrowDownRight className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
        ) : (
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ fontWeight: 500 }}>{event.content}</span>
          {event.tag && (
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">{event.tag}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
          <span>{event.date}</span>
          {event.amount !== undefined && (
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: event.direction === 'IN' ? '#059669' : event.direction === 'OUT' ? '#e11d48' : undefined }}>
              {event.direction === 'IN' ? '+' : event.direction === 'OUT' ? '-' : ''}
              {fmtKRW(event.amount)}원
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RowDetail ──
function RowDetail({ row }: { row: BudgetRow }) {
  const fields = [
    { label: '사업비 구분', value: row.category },
    { label: '비목', value: row.budgetCode },
    { label: '세목', value: row.subCode },
    { label: '산정 내역', value: row.calcDesc || '-' },
    { label: '최초 승인 예산', value: fmtKRW(row.initialBudget) + '원' },
    { label: '변경 예산 (8월)', value: fmtKRW(row.revisedAug) + '원' },
    { label: '변경 예산 (10월)', value: fmtKRW(row.revisedOct) + '원' },
    { label: '구성비', value: fmtPercent(row.composition) },
    { label: '소진금액', value: fmtKRW(row.spent) + '원' },
    { label: '매입부가세', value: fmtKRW(row.vatPurchase) + '원' },
    { label: '소진율', value: fmtPercent(row.burnRate) },
    { label: '잔액', value: fmtKRW(row.balance) + '원' },
  ];

  return (
    <div className="space-y-4">
      {/* 상태 배지 */}
      <div className="flex items-center gap-2">
        {row.fixType === 'FIXED' && (
          <Badge className="text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
            <Lock className="w-3 h-3 mr-1" /> 고정 항목
          </Badge>
        )}
        {row.fixType === 'ADJUSTABLE' && (
          <Badge className="text-[10px] bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
            <SlidersHorizontal className="w-3 h-3 mr-1" /> 조정 가능
          </Badge>
        )}
      </div>

      {/* 필드 리스트 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {fields.map(f => (
          <div key={f.label}>
            <p className="text-[10px] text-muted-foreground">{f.label}</p>
            <p className="text-[12px]" style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{f.value}</p>
          </div>
        ))}
      </div>

      {/* 특이사항 */}
      {row.note && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-[11px]" style={{ fontWeight: 600, color: '#d97706' }}>특이사항</span>
          </div>
          <p className="text-[11px] text-amber-800 dark:text-amber-200">{row.note}</p>
        </div>
      )}

      {/* 소진율 시각화 */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1.5">소진율</p>
        <div className="w-full h-3 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(row.burnRate * 100, 100)}%`,
              background: row.burnRate > 0.5 ? '#e11d48' : row.burnRate > 0.25 ? '#f59e0b' : '#059669',
            }}
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>소진: {fmtKRW(row.spent)}원</span>
          <span>잔액: {fmtKRW(row.balance)}원</span>
        </div>
      </div>
    </div>
  );
}
