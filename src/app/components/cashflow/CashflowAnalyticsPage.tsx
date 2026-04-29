import { useMemo, useState, type ComponentType } from 'react';
import {
  ArrowDownRight,
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Filter,
  Hash,
  Layers,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { useAppStore } from '../../data/store';
import {
  CASHFLOW_CATEGORY_LABELS,
  PROJECT_TYPE_SHORT_LABELS,
  type CashflowCategory,
  type Direction,
  type ProjectType,
  type TransactionState,
} from '../../data/types';
import { buildCashflowAnalytics } from '../../platform/cashflow-analytics';

const STATE_LABELS: Record<TransactionState, string> = {
  DRAFT: '초안',
  SUBMITTED: '제출',
  APPROVED: '승인',
  REJECTED: '반려',
};

const DIRECTION_LABELS: Record<Direction, string> = {
  IN: '입금',
  OUT: '출금',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(0)}만`;
  return n.toLocaleString('ko-KR');
}

function CfMetric({
  icon: Icon,
  label,
  value,
  sub,
  color,
  bgColor,
}: {
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  sub?: string;
  color: string;
  bgColor: string;
}) {
  return (
    <Card className="overflow-hidden border-border/40 shadow-sm">
      <CardContent className="p-0">
        <div className="relative p-4">
          <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: color }} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] text-muted-foreground" style={{ fontWeight: 600 }}>{label}</p>
              <p
                className="text-[21px]"
                style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color }}
              >
                {value}
              </p>
              {sub && <p className="mt-1 truncate text-[10px] text-muted-foreground">{sub}</p>}
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: bgColor }}>
              <Icon className="h-4.5 w-4.5" style={{ color }} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function stateBadgeClass(state: TransactionState) {
  if (state === 'APPROVED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (state === 'SUBMITTED') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (state === 'REJECTED') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function CashflowAnalyticsPage() {
  const { transactions, projects } = useAppStore();
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [directionFilter, setDirectionFilter] = useState('ALL');
  const [stateFilter, setStateFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const departments = useMemo(
    () => [...new Set(projects.map((project) => project.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko-KR')),
    [projects],
  );

  const analytics = useMemo(
    () => buildCashflowAnalytics({
      transactions,
      projects,
      filters: {
        projectId: projectFilter === 'ALL' ? undefined : projectFilter,
        projectType: typeFilter === 'ALL' ? undefined : typeFilter as ProjectType,
        department: departmentFilter === 'ALL' ? undefined : departmentFilter,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        direction: directionFilter === 'ALL' ? undefined : directionFilter as Direction,
        state: stateFilter === 'ALL' ? undefined : stateFilter as TransactionState,
        cashflowCategory: categoryFilter === 'ALL' ? undefined : categoryFilter as CashflowCategory,
      },
    }),
    [transactions, projects, projectFilter, typeFilter, departmentFilter, startDate, endDate, directionFilter, stateFilter, categoryFilter],
  );

  const categoryChartData = useMemo(
    () => analytics.categoryRows.map((row) => ({
      name: row.label,
      입금: row.inAmt,
      출금: row.outAmt,
    })),
    [analytics.categoryRows],
  );

  const activeFilters = [
    projectFilter,
    typeFilter,
    departmentFilter,
    directionFilter,
    stateFilter,
    categoryFilter,
    startDate,
    endDate,
  ].filter((value) => value && value !== 'ALL').length;

  const resetFilters = () => {
    setProjectFilter('ALL');
    setTypeFilter('ALL');
    setDepartmentFilter('ALL');
    setStartDate('');
    setEndDate('');
    setDirectionFilter('ALL');
    setStateFilter('ALL');
    setCategoryFilter('ALL');
  };

  const handleProjectFilterChange = (value: string) => {
    setProjectFilter(value);
    if (value !== 'ALL') {
      setTypeFilter('ALL');
      setDepartmentFilter('ALL');
    }
  };

  const { totals } = analytics;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488, #14b8a6)"
        title="캐시플로 분석"
        description={`사업·통장사용내역 기반 조회/필터/집계 · ${totals.count}건 거래`}
        badge={activeFilters > 0 ? `필터 ${activeFilters}개 적용` : undefined}
      />

      <div className="rounded-lg border border-border/40 bg-card p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span style={{ fontWeight: 700 }}>조회 조건</span>
          </div>
          {activeFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] text-muted-foreground"
              onClick={resetFilters}
            >
              초기화
            </Button>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Select value={projectFilter} onValueChange={handleProjectFilterChange}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="사업" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 사업</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id} className="text-[11px]">{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter} disabled={projectFilter !== 'ALL'}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="유형" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 유형</SelectItem>
              {(Object.keys(PROJECT_TYPE_SHORT_LABELS) as ProjectType[]).map((key) => (
                <SelectItem key={key} value={key} className="text-[11px]">{PROJECT_TYPE_SHORT_LABELS[key]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter} disabled={projectFilter !== 'ALL'}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="부서" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 부서</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department} value={department} className="text-[11px]">{department}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={directionFilter} onValueChange={setDirectionFilter}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="입출금" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">입출금 전체</SelectItem>
              <SelectItem value="IN">입금</SelectItem>
              <SelectItem value="OUT">출금</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="상태" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">상태 전체</SelectItem>
              {(Object.keys(STATE_LABELS) as TransactionState[]).map((state) => (
                <SelectItem key={state} value={state} className="text-[11px]">{STATE_LABELS[state]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 text-[11px]"><SelectValue placeholder="cashflow 항목" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">전체 항목</SelectItem>
              {(Object.keys(CASHFLOW_CATEGORY_LABELS) as CashflowCategory[]).map((category) => (
                <SelectItem key={category} value={category} className="text-[11px]">{CASHFLOW_CATEGORY_LABELS[category]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="h-8 text-[11px]"
            aria-label="시작일"
          />
          <Input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="h-8 text-[11px]"
            aria-label="종료일"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CfMetric
          icon={ArrowUpRight}
          label="총 입금"
          value={fmtShort(totals.totalIn)}
          sub={`${fmt(totals.depositAmount)}원 입금액`}
          color="#059669"
          bgColor="#05966912"
        />
        <CfMetric
          icon={ArrowDownRight}
          label="총 출금"
          value={fmtShort(totals.totalOut)}
          sub={`${fmt(totals.expenseAmount)}원 사업비`}
          color="#e11d48"
          bgColor="#e11d4812"
        />
        <CfMetric
          icon={ArrowDownUp}
          label="NET (순현금)"
          value={fmtShort(totals.net)}
          sub={totals.net >= 0 ? '입금 초과' : '출금 초과'}
          color={totals.net >= 0 ? '#059669' : '#e11d48'}
          bgColor={totals.net >= 0 ? '#05966912' : '#e11d4812'}
        />
        <CfMetric
          icon={Hash}
          label="거래 건수"
          value={`${totals.count}건`}
          sub={`승인 ${totals.approved}건`}
          color="#4f46e5"
          bgColor="#4f46e512"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CfMetric
          icon={ReceiptText}
          label="매입부가세"
          value={fmtShort(totals.inputVat)}
          sub={`${fmt(totals.inputVat)}원`}
          color="#b45309"
          bgColor="#b4530912"
        />
        <CfMetric
          icon={WalletCards}
          label="매출부가세"
          value={fmtShort(totals.outputVat)}
          sub={`${fmt(totals.outputVat)}원`}
          color="#0f766e"
          bgColor="#0f766e12"
        />
        <CfMetric
          icon={TrendingUp}
          label="부가세 환급"
          value={fmtShort(totals.vatRefund)}
          sub={`${fmt(totals.vatRefund)}원`}
          color="#2563eb"
          bgColor="#2563eb12"
        />
        <CfMetric
          icon={ClipboardList}
          label="예수금 잔액"
          value={fmtShort(totals.withholdingBalance)}
          sub="매출부가세 - 매입부가세 - 환급"
          color={totals.withholdingBalance >= 0 ? '#7c3aed' : '#dc2626'}
          bgColor={totals.withholdingBalance >= 0 ? '#7c3aed12' : '#dc262612'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-50">
                <TrendingUp className="h-3.5 w-3.5 text-teal-600" />
              </div>
              월별 통장사용내역 추이
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.monthlyRows}>
                  <defs>
                    <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(value: string) => value.slice(5)} />
                  <YAxis tickFormatter={(value: number) => fmtShort(value)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={55} />
                  <RTooltip
                    formatter={(value: number, name: string) => [(`${fmt(value)}원`), name === 'in' ? '입금' : name === 'out' ? '출금' : 'NET']}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
                  />
                  <Area type="monotone" dataKey="in" name="in" stroke="#10b981" strokeWidth={2} fill="url(#gIn)" />
                  <Area type="monotone" dataKey="out" name="out" stroke="#f43f5e" strokeWidth={2} fill="url(#gOut)" />
                  <Line type="monotone" dataKey="net" name="net" stroke="#6366f1" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: '#6366f1' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50">
                <Layers className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              항목별 입출금
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={(value: number) => fmtShort(value)} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="name" width={76} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <RTooltip
                    formatter={(value: number) => `${fmt(value)}원`}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="입금" fill="#10b981" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="출금" fill="#f43f5e" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50">
                <BarChart3 className="h-3.5 w-3.5 text-emerald-600" />
              </div>
              사업별 집계
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[170px] text-[10px]">사업</TableHead>
                    <TableHead className="text-[10px]">부서</TableHead>
                    <TableHead className="text-right text-[10px]">입금</TableHead>
                    <TableHead className="text-right text-[10px]">사업비</TableHead>
                    <TableHead className="text-right text-[10px]">매입VAT</TableHead>
                    <TableHead className="text-right text-[10px]">매출VAT</TableHead>
                    <TableHead className="text-right text-[10px]">예수금</TableHead>
                    <TableHead className="text-center text-[10px]">건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.projectRows.map((row) => (
                    <TableRow key={row.projectId} className="h-9 hover:bg-muted/50">
                      <TableCell className="max-w-[220px] text-[11px]" style={{ fontWeight: 600 }}>
                        <div className="truncate">{row.name}</div>
                        <div className="text-[10px] text-muted-foreground">{row.typeLabel}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[10px] text-muted-foreground">{row.department}</TableCell>
                      <TableCell className="text-right text-[11px] text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.totalIn)}</TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.expenseAmount)}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.inputVat)}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.outputVat)}</TableCell>
                      <TableCell className={`text-right text-[11px] ${row.withholdingBalance >= 0 ? 'text-violet-700' : 'text-rose-700'}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(row.withholdingBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" style={{ fontWeight: 700 }}>{row.count}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {analytics.projectRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-8 text-center text-[12px] text-muted-foreground">조회 조건에 맞는 사업 집계가 없습니다.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[13px]">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-50">
                <ReceiptText className="h-3.5 w-3.5 text-amber-700" />
              </div>
              항목별 상세
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">항목</TableHead>
                    <TableHead className="text-right text-[10px]">입금</TableHead>
                    <TableHead className="text-right text-[10px]">출금</TableHead>
                    <TableHead className="text-right text-[10px]">VAT</TableHead>
                    <TableHead className="text-center text-[10px]">건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.categoryRows.map((row) => (
                    <TableRow key={row.category} className="h-9 hover:bg-muted/50">
                      <TableCell className="text-[11px]" style={{ fontWeight: 600 }}>{row.label}</TableCell>
                      <TableCell className="text-right text-[11px] text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.inAmt > 0 ? fmtShort(row.inAmt) : '-'}</TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.outAmt > 0 ? fmtShort(row.outAmt) : '-'}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(row.outputVat - row.inputVat - row.vatRefund)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" style={{ fontWeight: 700 }}>{row.count}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {analytics.categoryRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-[12px] text-muted-foreground">조회 조건에 맞는 항목 집계가 없습니다.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[13px]">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100">
              <ClipboardList className="h-3.5 w-3.5 text-slate-700" />
            </div>
            통장사용내역 상세
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[92px] text-[10px]">거래일</TableHead>
                  <TableHead className="min-w-[180px] text-[10px]">사업</TableHead>
                  <TableHead className="text-[10px]">상태</TableHead>
                  <TableHead className="text-[10px]">구분</TableHead>
                  <TableHead className="min-w-[120px] text-[10px]">거래처</TableHead>
                  <TableHead className="min-w-[120px] text-[10px]">cashflow 항목</TableHead>
                  <TableHead className="text-right text-[10px]">통장금액</TableHead>
                  <TableHead className="text-right text-[10px]">사업비</TableHead>
                  <TableHead className="text-right text-[10px]">매입VAT</TableHead>
                  <TableHead className="text-right text-[10px]">매출VAT</TableHead>
                  <TableHead className="min-w-[180px] text-[10px]">메모</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.transactions.map((transaction) => (
                  <TableRow key={transaction.id} className="h-9 hover:bg-muted/50">
                    <TableCell className="whitespace-nowrap text-[11px]">{transaction.dateTime.slice(0, 10)}</TableCell>
                    <TableCell className="max-w-[240px] text-[11px]">
                      <div className="truncate" style={{ fontWeight: 600 }}>{transaction.projectName}</div>
                      <div className="text-[10px] text-muted-foreground">{transaction.projectDepartment} · {transaction.projectTypeLabel}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`h-5 border px-1.5 text-[10px] ${stateBadgeClass(transaction.state)}`}>
                        {STATE_LABELS[transaction.state]}
                      </Badge>
                    </TableCell>
                    <TableCell className={transaction.direction === 'IN' ? 'text-[11px] text-emerald-700' : 'text-[11px] text-rose-700'} style={{ fontWeight: 700 }}>
                      {DIRECTION_LABELS[transaction.direction]}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-[11px]">{transaction.counterparty || '-'}</TableCell>
                    <TableCell className="whitespace-nowrap text-[11px]">{CASHFLOW_CATEGORY_LABELS[transaction.cashflowCategory]}</TableCell>
                    <TableCell className={`text-right text-[11px] ${transaction.direction === 'IN' ? 'text-emerald-700' : 'text-rose-700'}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {transaction.direction === 'IN' ? '+' : '-'}{fmt(transaction.amounts.bankAmount)}
                    </TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.expenseAmount > 0 ? fmt(transaction.amounts.expenseAmount) : '-'}</TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.vatIn > 0 ? fmt(transaction.amounts.vatIn) : '-'}</TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.vatOut > 0 ? fmt(transaction.amounts.vatOut) : '-'}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-[11px] text-muted-foreground">{transaction.memo || '-'}</TableCell>
                  </TableRow>
                ))}
                {analytics.transactions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-[12px] text-muted-foreground">조회 조건에 맞는 통장사용내역이 없습니다.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
