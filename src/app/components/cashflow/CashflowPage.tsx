import React, { useState, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, ArrowDownUp, Filter, BarChart3,
  ArrowUpRight, ArrowDownRight, Hash, Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts';
import { useAppStore } from '../../data/store';
import {
  CASHFLOW_CATEGORY_LABELS, PROJECT_TYPE_SHORT_LABELS,
  type CashflowCategory, type ProjectType,
} from '../../data/types';
import { PageHeader } from '../layout/PageHeader';

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

function fmtShort(n: number) {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString();
}

// ── Cashflow Metric Card ──
function CfMetric({ icon: Icon, label, value, sub, color, bgColor }: {
  icon: any; label: string; value: string; sub?: string; color: string; bgColor: string;
}) {
  return (
    <Card className="shadow-sm border-border/40 overflow-hidden">
      <CardContent className="p-0">
        <div className="p-4 relative">
          <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: color }} />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground mb-1" style={{ fontWeight: 500 }}>{label}</p>
              <p className="text-[22px]" style={{ fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color }}>
                {value}
              </p>
              {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
            </div>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: bgColor }}>
              <Icon className="w-4.5 h-4.5" style={{ color }} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CashflowPage() {
  const { transactions, projects } = useAppStore();
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');

  const departments = useMemo(() => [...new Set(projects.map(p => p.department))], [projects]);

  const filteredTx = useMemo(() => {
    return transactions.filter(t => {
      if (projectFilter !== 'ALL' && t.projectId !== projectFilter) return false;
      if (typeFilter !== 'ALL') {
        const proj = projects.find(p => p.id === t.projectId);
        if (!proj || proj.type !== typeFilter) return false;
      }
      if (departmentFilter !== 'ALL') {
        const proj = projects.find(p => p.id === t.projectId);
        if (!proj || proj.department !== departmentFilter) return false;
      }
      return true;
    });
  }, [transactions, projectFilter, typeFilter, departmentFilter, projects]);

  const monthlyData = useMemo(() => {
    const months: Record<string, { month: string; in: number; out: number; net: number }> = {};
    filteredTx.forEach(t => {
      const m = t.dateTime.substring(0, 7);
      if (!months[m]) months[m] = { month: m, in: 0, out: 0, net: 0 };
      if (t.direction === 'IN') months[m].in += t.amounts.bankAmount;
      else months[m].out += t.amounts.bankAmount;
    });
    Object.values(months).forEach(m => { m.net = m.in - m.out; });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredTx]);

  const categoryData = useMemo(() => {
    const map: Record<string, { category: CashflowCategory; label: string; inAmt: number; outAmt: number; count: number }> = {};
    filteredTx.forEach(t => {
      const cat = t.cashflowCategory;
      if (!map[cat]) map[cat] = { category: cat, label: CASHFLOW_CATEGORY_LABELS[cat], inAmt: 0, outAmt: 0, count: 0 };
      map[cat].count++;
      if (t.direction === 'IN') map[cat].inAmt += t.amounts.bankAmount;
      else map[cat].outAmt += t.amounts.bankAmount;
    });
    return Object.values(map).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt));
  }, [filteredTx]);

  const projectData = useMemo(() => {
    const map: Record<string, { projectId: string; name: string; type: string; inAmt: number; outAmt: number; count: number }> = {};
    filteredTx.forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      if (!map[t.projectId]) {
        map[t.projectId] = {
          projectId: t.projectId,
          name: proj?.name || '',
          type: proj?.type || '',
          inAmt: 0, outAmt: 0, count: 0,
        };
      }
      map[t.projectId].count++;
      if (t.direction === 'IN') map[t.projectId].inAmt += t.amounts.bankAmount;
      else map[t.projectId].outAmt += t.amounts.bankAmount;
    });
    return Object.values(map).sort((a, b) => (b.inAmt + b.outAmt) - (a.inAmt + a.outAmt));
  }, [filteredTx, projects]);

  const categoryChartData = useMemo(() => {
    return categoryData.map(c => ({
      name: c.label,
      입금: c.inAmt,
      출금: c.outAmt,
    }));
  }, [categoryData]);

  const totals = useMemo(() => {
    const totalIn = filteredTx.filter(t => t.direction === 'IN').reduce((s, t) => s + t.amounts.bankAmount, 0);
    const totalOut = filteredTx.filter(t => t.direction === 'OUT').reduce((s, t) => s + t.amounts.bankAmount, 0);
    const approved = filteredTx.filter(t => t.state === 'APPROVED').length;
    return { totalIn, totalOut, net: totalIn - totalOut, count: filteredTx.length, approved };
  }, [filteredTx]);

  const activeFilters = [projectFilter, typeFilter, departmentFilter].filter(f => f !== 'ALL').length;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0d9488, #14b8a6)"
        title="캐시플로 분석"
        description={`전사 프로젝트 입출금 통합 현황 · ${totals.count}건 거래`}
        badge={activeFilters > 0 ? `필터 ${activeFilters}개 적용` : undefined}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-border/40 bg-card shadow-sm">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span style={{ fontWeight: 500 }}>필터</span>
        </div>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-8 w-[180px] text-[11px]"><SelectValue placeholder="프로젝트" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 프로젝트</SelectItem>
            {projects.map(p => (
              <SelectItem key={p.id} value={p.id} className="text-[11px]">{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[120px] text-[11px]"><SelectValue placeholder="유형" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 유형</SelectItem>
            {(Object.keys(PROJECT_TYPE_SHORT_LABELS) as ProjectType[]).map(k => (
              <SelectItem key={k} value={k} className="text-[11px]">{PROJECT_TYPE_SHORT_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="h-8 w-[130px] text-[11px]"><SelectValue placeholder="부서" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 부서</SelectItem>
            {departments.map(d => (
              <SelectItem key={d} value={d} className="text-[11px]">{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[10px] text-muted-foreground"
            onClick={() => { setProjectFilter('ALL'); setTypeFilter('ALL'); setDepartmentFilter('ALL'); }}
          >
            초기화
          </Button>
        )}
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CfMetric
          icon={ArrowUpRight}
          label="총 입금"
          value={fmtShort(totals.totalIn)}
          sub={`${fmt(totals.totalIn)}원`}
          color="#059669"
          bgColor="#05966912"
        />
        <CfMetric
          icon={ArrowDownRight}
          label="총 출금"
          value={fmtShort(totals.totalOut)}
          sub={`${fmt(totals.totalOut)}원`}
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-teal-50 dark:bg-teal-950/40 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              </div>
              월별 캐시플로 추이
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
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
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={55} />
                  <RTooltip
                    formatter={(v: number, name: string) => [fmt(v) + '원', name === 'in' ? '입금' : name === 'out' ? '출금' : 'NET']}
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

        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
              항목별 입출금
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChartData} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tickFormatter={(v: number) => fmtShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <RTooltip
                    formatter={(v: number) => fmt(v) + '원'}
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

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center">
                <BarChart3 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
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
                    <TableHead className="text-right text-[10px]">NET</TableHead>
                    <TableHead className="text-center text-[10px]">건수</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryData.map(c => (
                    <TableRow key={c.category} className="hover:bg-muted/50 h-9">
                      <TableCell className="text-[11px]" style={{ fontWeight: 500 }}>{c.label}</TableCell>
                      <TableCell className="text-right text-[11px] text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {c.inAmt > 0 ? fmtShort(c.inAmt) : '-'}
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {c.outAmt > 0 ? fmtShort(c.outAmt) : '-'}
                      </TableCell>
                      <TableCell className={`text-right text-[11px] ${(c.inAmt - c.outAmt) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(c.inAmt - c.outAmt)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-md" style={{ fontWeight: 600 }}>{c.count}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-border bg-muted/30">
                    <TableCell className="text-[11px]" style={{ fontWeight: 700 }}>합계</TableCell>
                    <TableCell className="text-right text-[11px] text-emerald-700" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(totals.totalIn)}</TableCell>
                    <TableCell className="text-right text-[11px] text-rose-700" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtShort(totals.totalOut)}</TableCell>
                    <TableCell className={`text-right text-[11px] ${totals.net >= 0 ? 'text-emerald-700' : 'text-rose-700'}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtShort(totals.net)}
                    </TableCell>
                    <TableCell className="text-center text-[11px]" style={{ fontWeight: 700 }}>{totals.count}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center">
                <Layers className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
              </div>
              프로젝트별 상세
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] min-w-[120px]">프로젝트</TableHead>
                    <TableHead className="text-[10px]">유형</TableHead>
                    <TableHead className="text-right text-[10px]">입금</TableHead>
                    <TableHead className="text-right text-[10px]">출금</TableHead>
                    <TableHead className="text-right text-[10px]">NET</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectData.map(p => (
                    <TableRow key={p.projectId} className="hover:bg-muted/50 h-9">
                      <TableCell className="text-[11px] max-w-[140px] truncate" style={{ fontWeight: 500 }}>{p.name}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {PROJECT_TYPE_SHORT_LABELS[p.type as ProjectType] || p.type}
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-emerald-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(p.inAmt)}
                      </TableCell>
                      <TableCell className="text-right text-[11px] text-rose-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(p.outAmt)}
                      </TableCell>
                      <TableCell className={`text-right text-[11px] ${(p.inAmt - p.outAmt) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`} style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtShort(p.inAmt - p.outAmt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}