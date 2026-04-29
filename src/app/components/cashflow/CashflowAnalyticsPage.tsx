import { useMemo, useState, type ComponentType } from 'react';
import {
  ArrowDownRight,
  ArrowDownUp,
  ArrowUpRight,
  BarChart3,
  ClipboardList,
  Hash,
  Layers,
  ReceiptText,
  Search,
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

const REPORT_TEAL = '#008c86';
const REPORT_DARK_TEAL = '#00766f';
const REPORT_BORDER = '#c7c7c7';
const REPORT_GRAY = '#8a8f94';

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
    <Card className="overflow-hidden rounded-none border border-[#d7d7d7] bg-white shadow-none">
      <CardContent className="p-0">
        <div className="relative p-4">
          <div className="absolute left-0 right-0 top-0 h-[2px]" style={{ background: color }} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] text-[#6f7478]" style={{ fontWeight: 700 }}>{label}</p>
              <p
                className="text-[21px]"
                style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color }}
              >
                {value}
              </p>
              {sub && <p className="mt-1 truncate text-[10px] text-[#8a8f94]">{sub}</p>}
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm" style={{ background: bgColor }}>
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

function reportSectionTitle(title: string, Icon: ComponentType<{ className?: string }>) {
  return (
    <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: REPORT_TEAL }}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: REPORT_TEAL }} />
        <span className="text-[15px] text-zinc-950" style={{ fontWeight: 800 }}>{title}</span>
      </div>
    </div>
  );
}

function FilterLabel({ label, disabled = false }: { label: string; disabled?: boolean }) {
  return (
    <span className={`mb-1 block text-[10px] ${disabled ? 'text-slate-400' : 'text-[#6f7478]'}`} style={{ fontWeight: 700 }}>
      {label}
    </span>
  );
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

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectFilter),
    [projects, projectFilter],
  );

  const activeFilterItems = useMemo(() => {
    const items: Array<{ label: string; value: string }> = [];
    if (selectedProject) items.push({ label: '사업', value: selectedProject.name });
    if (projectFilter === 'ALL' && typeFilter !== 'ALL') items.push({ label: '유형', value: PROJECT_TYPE_SHORT_LABELS[typeFilter as ProjectType] || typeFilter });
    if (projectFilter === 'ALL' && departmentFilter !== 'ALL') items.push({ label: '부서', value: departmentFilter });
    if (directionFilter !== 'ALL') items.push({ label: '입출금', value: DIRECTION_LABELS[directionFilter as Direction] });
    if (stateFilter !== 'ALL') items.push({ label: '상태', value: STATE_LABELS[stateFilter as TransactionState] });
    if (categoryFilter !== 'ALL') items.push({ label: '항목', value: CASHFLOW_CATEGORY_LABELS[categoryFilter as CashflowCategory] });
    if (startDate) items.push({ label: '시작일', value: startDate });
    if (endDate) items.push({ label: '종료일', value: endDate });
    return items;
  }, [categoryFilter, departmentFilter, directionFilter, endDate, projectFilter, selectedProject, startDate, stateFilter, typeFilter]);

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
    <div className="space-y-5 bg-white px-1 pb-8 text-zinc-950">
      <section className="relative border bg-white px-6 py-5" style={{ borderColor: REPORT_BORDER }}>
        <div className="absolute left-0 top-0 h-12 w-2" style={{ background: REPORT_TEAL }} />
        <div className="absolute left-0 top-12 h-12 w-2 bg-[#b8b8b8]" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 pl-3">
            <p className="text-[13px]" style={{ color: REPORT_TEAL, fontWeight: 800 }}>Cashflow Admin Report</p>
            <h1 className="mt-2 text-[28px] leading-tight text-zinc-950" style={{ fontWeight: 900 }}>
              캐시플로 분석
            </h1>
            <p className="mt-2 text-[12px] text-[#6f7478]">
              사업·통장사용내역 기반 조회/필터/집계 · 현재 조건 {totals.count}건
            </p>
          </div>
          <div className="hidden text-right sm:block">
            <p className="text-[34px] leading-none text-[#c9c9c9]" style={{ fontWeight: 900 }}>2026</p>
            <p className="text-[11px] text-[#7d8286]" style={{ fontWeight: 800 }}>MYSC Cashflow Guide</p>
          </div>
        </div>
      </section>

      <section className="border bg-white p-4" style={{ borderColor: REPORT_BORDER }}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4" style={{ color: REPORT_TEAL }} />
            <div>
              <p className="text-[13px] text-zinc-950" style={{ fontWeight: 800 }}>조회 조건</p>
              <p className="text-[10px] text-[#7d8286]">
                사업을 직접 선택하면 유형·부서 조건은 자동으로 전체 처리됩니다.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-none border-[#c7c7c7] bg-white px-3 text-[10px] text-zinc-700 hover:bg-[#f5f7f7]"
            onClick={resetFilters}
            disabled={activeFilters === 0}
          >
            전체 초기화
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <div>
            <FilterLabel label="사업" />
            <Select value={projectFilter} onValueChange={handleProjectFilterChange}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="사업" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 사업</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id} className="text-[11px]">{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="사업유형" disabled={projectFilter !== 'ALL'} />
            <Select value={typeFilter} onValueChange={setTypeFilter} disabled={projectFilter !== 'ALL'}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="유형" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 유형</SelectItem>
                {(Object.keys(PROJECT_TYPE_SHORT_LABELS) as ProjectType[]).map((key) => (
                  <SelectItem key={key} value={key} className="text-[11px]">{PROJECT_TYPE_SHORT_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="부서" disabled={projectFilter !== 'ALL'} />
            <Select value={departmentFilter} onValueChange={setDepartmentFilter} disabled={projectFilter !== 'ALL'}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="부서" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 부서</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department} value={department} className="text-[11px]">{department}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="입출금" />
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="입출금" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">입출금 전체</SelectItem>
                <SelectItem value="IN">입금</SelectItem>
                <SelectItem value="OUT">출금</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="상태" />
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="상태" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">상태 전체</SelectItem>
                {(Object.keys(STATE_LABELS) as TransactionState[]).map((state) => (
                  <SelectItem key={state} value={state} className="text-[11px]">{STATE_LABELS[state]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="cashflow 항목" />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"><SelectValue placeholder="cashflow 항목" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 항목</SelectItem>
                {(Object.keys(CASHFLOW_CATEGORY_LABELS) as CashflowCategory[]).map((category) => (
                  <SelectItem key={category} value={category} className="text-[11px]">{CASHFLOW_CATEGORY_LABELS[category]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FilterLabel label="시작일" />
            <Input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"
              aria-label="시작일"
            />
          </div>
          <div>
            <FilterLabel label="종료일" />
            <Input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-8 rounded-none border-[#bfc6c5] bg-white text-[11px]"
              aria-label="종료일"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3" style={{ borderColor: '#e1e1e1' }}>
          <span className="mr-1 text-[10px] text-[#7d8286]" style={{ fontWeight: 800 }}>적용 조건</span>
          {activeFilterItems.length === 0 ? (
            <span className="text-[10px] text-[#8a8f94]">전체 데이터 기준</span>
          ) : activeFilterItems.map((item) => (
            <span key={`${item.label}:${item.value}`} className="inline-flex h-5 items-center border border-[#bfc6c5] bg-[#f7fbfb] px-2 text-[10px] text-zinc-800">
              <span className="mr-1" style={{ color: REPORT_TEAL, fontWeight: 800 }}>{item.label}</span>
              {item.value}
            </span>
          ))}
        </div>
      </section>

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
        <Card className="rounded-none border border-[#d7d7d7] bg-white shadow-none">
          <CardHeader className="pb-2">
            <CardTitle>{reportSectionTitle('월별 통장사용내역 추이', TrendingUp)}</CardTitle>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: REPORT_GRAY }} tickFormatter={(value: string) => value.slice(5)} />
                  <YAxis tickFormatter={(value: number) => fmtShort(value)} tick={{ fontSize: 10, fill: REPORT_GRAY }} width={55} />
                  <RTooltip
                    formatter={(value: number, name: string) => [(`${fmt(value)}원`), name === 'in' ? '입금' : name === 'out' ? '출금' : 'NET']}
                    contentStyle={{ borderRadius: 0, border: '1px solid #c7c7c7', fontSize: 11, boxShadow: 'none' }}
                  />
                  <Area type="monotone" dataKey="in" name="in" stroke={REPORT_TEAL} strokeWidth={2} fill="url(#gIn)" />
                  <Area type="monotone" dataKey="out" name="out" stroke="#a7a7a7" strokeWidth={2} fill="url(#gOut)" />
                  <Line type="monotone" dataKey="net" name="net" stroke={REPORT_DARK_TEAL} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: REPORT_DARK_TEAL }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-[#d7d7d7] bg-white shadow-none">
          <CardHeader className="pb-2">
            <CardTitle>{reportSectionTitle('항목별 입출금', Layers)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e6e6e6" />
                  <XAxis type="number" tickFormatter={(value: number) => fmtShort(value)} tick={{ fontSize: 10, fill: REPORT_GRAY }} />
                  <YAxis type="category" dataKey="name" width={76} tick={{ fontSize: 10, fill: '#4f565a' }} />
                  <RTooltip
                    formatter={(value: number) => `${fmt(value)}원`}
                    contentStyle={{ borderRadius: 0, border: '1px solid #c7c7c7', fontSize: 11, boxShadow: 'none' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="입금" fill={REPORT_TEAL} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="출금" fill="#bdbdbd" radius={[0, 0, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-none border border-[#d7d7d7] bg-white shadow-none">
          <CardHeader className="pb-2">
            <CardTitle>{reportSectionTitle('사업별 집계', BarChart3)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[170px] bg-[#e5e5e5] text-[10px] text-zinc-900">사업</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-[10px] text-zinc-900">부서</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">입금</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">사업비</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">매입VAT</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">매출VAT</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">예수금</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-center text-[10px] text-zinc-900">건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.projectRows.map((row) => (
                    <TableRow key={row.projectId} className="h-9 border-[#d6d6d6] hover:bg-[#f6fbfb]">
                      <TableCell className="max-w-[220px] text-[11px]" style={{ fontWeight: 600 }}>
                        <div className="truncate">{row.name}</div>
                        <div className="text-[10px] text-muted-foreground">{row.typeLabel}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[10px] text-[#6f7478]">{row.department}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ color: REPORT_TEAL, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.totalIn)}</TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.expenseAmount)}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.inputVat)}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShort(row.outputVat)}</TableCell>
                      <TableCell className={`text-right text-[11px] ${row.withholdingBalance >= 0 ? 'text-zinc-900' : 'text-rose-700'}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(row.withholdingBalance)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="border border-[#c7c7c7] bg-white px-1.5 py-0.5 text-[10px] text-zinc-700" style={{ fontWeight: 700 }}>{row.count}</span>
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

        <Card className="rounded-none border border-[#d7d7d7] bg-white shadow-none">
          <CardHeader className="pb-2">
            <CardTitle>{reportSectionTitle('항목별 상세', ReceiptText)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-[#e5e5e5] text-[10px] text-zinc-900">항목</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">입금</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">출금</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">VAT</TableHead>
                    <TableHead className="bg-[#e5e5e5] text-center text-[10px] text-zinc-900">건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.categoryRows.map((row) => (
                    <TableRow key={row.category} className="h-9 border-[#d6d6d6] hover:bg-[#f6fbfb]">
                      <TableCell className="text-[11px]" style={{ fontWeight: 600 }}>{row.label}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ color: REPORT_TEAL, fontVariantNumeric: 'tabular-nums' }}>{row.inAmt > 0 ? fmtShort(row.inAmt) : '-'}</TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.outAmt > 0 ? fmtShort(row.outAmt) : '-'}</TableCell>
                      <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(row.outputVat - row.inputVat - row.vatRefund)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="border border-[#c7c7c7] bg-white px-1.5 py-0.5 text-[10px] text-zinc-700" style={{ fontWeight: 700 }}>{row.count}</span>
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

      <Card className="rounded-none border border-[#d7d7d7] bg-white shadow-none">
        <CardHeader className="pb-2">
          <CardTitle>{reportSectionTitle('통장사용내역 상세', ClipboardList)}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[92px] bg-[#e5e5e5] text-[10px] text-zinc-900">거래일</TableHead>
                  <TableHead className="min-w-[180px] bg-[#e5e5e5] text-[10px] text-zinc-900">사업</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-[10px] text-zinc-900">상태</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-[10px] text-zinc-900">구분</TableHead>
                  <TableHead className="min-w-[120px] bg-[#e5e5e5] text-[10px] text-zinc-900">거래처</TableHead>
                  <TableHead className="min-w-[120px] bg-[#e5e5e5] text-[10px] text-zinc-900">cashflow 항목</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">통장금액</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">사업비</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">매입VAT</TableHead>
                  <TableHead className="bg-[#e5e5e5] text-right text-[10px] text-zinc-900">매출VAT</TableHead>
                  <TableHead className="min-w-[180px] bg-[#e5e5e5] text-[10px] text-zinc-900">메모</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.transactions.map((transaction) => (
                  <TableRow key={transaction.id} className="h-9 border-[#d6d6d6] hover:bg-[#f6fbfb]">
                    <TableCell className="whitespace-nowrap text-[11px]">{transaction.dateTime.slice(0, 10)}</TableCell>
                    <TableCell className="max-w-[240px] text-[11px]">
                      <div className="truncate" style={{ fontWeight: 600 }}>{transaction.projectName}</div>
                      <div className="text-[10px] text-[#6f7478]">{transaction.projectDepartment} · {transaction.projectTypeLabel}</div>
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
                    <TableCell className={`text-right text-[11px] ${transaction.direction === 'IN' ? '' : 'text-rose-700'}`} style={{ color: transaction.direction === 'IN' ? REPORT_TEAL : undefined, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {transaction.direction === 'IN' ? '+' : '-'}{fmt(transaction.amounts.bankAmount)}
                    </TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.expenseAmount > 0 ? fmt(transaction.amounts.expenseAmount) : '-'}</TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.vatIn > 0 ? fmt(transaction.amounts.vatIn) : '-'}</TableCell>
                    <TableCell className="text-right text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{transaction.amounts.vatOut > 0 ? fmt(transaction.amounts.vatOut) : '-'}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-[11px] text-[#6f7478]">{transaction.memo || '-'}</TableCell>
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
