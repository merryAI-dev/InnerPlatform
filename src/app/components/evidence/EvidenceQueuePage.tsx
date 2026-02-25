import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  FileCheck, AlertTriangle, Clock, CheckCircle2, XCircle,
  User, ExternalLink, Filter, Paperclip, Search, ArrowRight,
} from 'lucide-react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAppStore } from '../../data/store';
import {
  TX_STATE_LABELS, EVIDENCE_STATUS_LABELS, CASHFLOW_CATEGORY_LABELS,
  type EvidenceStatus,
} from '../../data/types';
import { PageHeader } from '../layout/PageHeader';
import { isValidDriveUrl } from '../../platform/evidence-helpers';

const evidenceStyles: Record<string, { bg: string; text: string; dot: string }> = {
  MISSING: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  PARTIAL: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  COMPLETE: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

const txStateStyles: Record<string, { bg: string; text: string }> = {
  DRAFT: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400' },
  SUBMITTED: { bg: 'bg-amber-50', text: 'text-amber-700' },
  APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  REJECTED: { bg: 'bg-rose-50', text: 'text-rose-700' },
};

function fmtShort(n: number) {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '억';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + '만';
  return n.toLocaleString();
}

export function EvidenceQueuePage() {
  const { transactions, projects, ledgers, members } = useAppStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState('incomplete');
  const [projectFilter, setProjectFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const incompleteTx = useMemo(() => {
    return transactions
      .filter(t => {
        if (t.evidenceStatus === 'COMPLETE') return false;
        if (t.state === 'REJECTED') return false;
        if (projectFilter !== 'ALL' && t.projectId !== projectFilter) return false;
        if (search) {
          const q = search.toLowerCase();
          const proj = projects.find(p => p.id === t.projectId);
          if (!t.counterparty.toLowerCase().includes(q) && !(proj?.name.toLowerCase().includes(q))) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.evidenceStatus !== b.evidenceStatus) return a.evidenceStatus === 'MISSING' ? -1 : 1;
        return b.dateTime.localeCompare(a.dateTime);
      });
  }, [transactions, projectFilter, search, projects]);

  const pendingTx = useMemo(() => {
    return transactions
      .filter(t => {
        if (t.state !== 'SUBMITTED') return false;
        if (projectFilter !== 'ALL' && t.projectId !== projectFilter) return false;
        return true;
      })
      .sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  }, [transactions, projectFilter]);

  const rejectedTx = useMemo(() => {
    return transactions
      .filter(t => {
        if (t.state !== 'REJECTED') return false;
        if (projectFilter !== 'ALL' && t.projectId !== projectFilter) return false;
        return true;
      })
      .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  }, [transactions, projectFilter]);

  const projectMap = useMemo(() => {
    const m: Record<string, string> = {};
    projects.forEach(p => { m[p.id] = p.name; });
    return m;
  }, [projects]);

  const ledgerMap = useMemo(() => {
    const m: Record<string, { name: string; projectId: string }> = {};
    ledgers.forEach(l => { m[l.id] = { name: l.name, projectId: l.projectId }; });
    return m;
  }, [ledgers]);

  const stats = useMemo(() => ({
    missing: transactions.filter(t => t.evidenceStatus === 'MISSING' && t.state !== 'REJECTED').length,
    partial: transactions.filter(t => t.evidenceStatus === 'PARTIAL' && t.state !== 'REJECTED').length,
    pending: transactions.filter(t => t.state === 'SUBMITTED').length,
    rejected: transactions.filter(t => t.state === 'REJECTED').length,
  }), [transactions]);

  const renderTxRow = (t: typeof transactions[0], showRejection?: boolean) => {
    const ledger = ledgerMap[t.ledgerId];
    const evSt = evidenceStyles[t.evidenceStatus];
    const txSt = txStateStyles[t.state];
    return (
      <TableRow
        key={t.id}
        className="cursor-pointer hover:bg-muted/50 transition-colors h-9"
        onClick={() => {
          if (ledger) navigate(`/projects/${t.projectId}/ledgers/${t.ledgerId}`);
        }}
      >
        <TableCell className="py-1 text-[10px] text-muted-foreground whitespace-nowrap">{t.dateTime.slice(2)}</TableCell>
        <TableCell className="py-1 text-[11px] max-w-[110px] truncate" style={{ fontWeight: 500 }}>
          {projectMap[t.projectId]}
        </TableCell>
        <TableCell className="py-1 text-[10px] text-muted-foreground max-w-[80px] truncate">
          {ledger?.name || '-'}
        </TableCell>
        <TableCell className="py-1 text-[11px]">{t.counterparty}</TableCell>
        <TableCell className="py-1 text-[10px] text-muted-foreground whitespace-nowrap">
          {CASHFLOW_CATEGORY_LABELS[t.cashflowCategory]}
        </TableCell>
        <TableCell className="py-1 text-right text-[11px] whitespace-nowrap" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          <span className={t.direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'}>
            {t.direction === 'IN' ? '+' : '-'}{fmtShort(t.amounts.bankAmount)}
          </span>
        </TableCell>
        <TableCell className="py-1">
          <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md ${evSt?.bg || ''} ${evSt?.text || ''}`} style={{ fontWeight: 500 }}>
            <span className={`w-1 h-1 rounded-full ${evSt?.dot || ''}`} />
            {EVIDENCE_STATUS_LABELS[t.evidenceStatus]}
          </span>
        </TableCell>
        <TableCell className="py-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${txSt?.bg || ''} ${txSt?.text || ''}`} style={{ fontWeight: 500 }}>
            {TX_STATE_LABELS[t.state]}
          </span>
        </TableCell>
        <TableCell className="py-1 text-center">
          {isValidDriveUrl(t.evidenceDriveLink || '') ? (
            <a
              href={t.evidenceDriveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center text-blue-500 hover:text-blue-700"
              onClick={(e) => e.stopPropagation()}
              title="Google Drive에서 열기"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-[9px] text-muted-foreground">-</span>
          )}
        </TableCell>
        <TableCell className="py-1 text-[10px] text-muted-foreground max-w-[100px] truncate">
          {showRejection ? (t.rejectedReason || '-') : (t.evidenceMissing.join(', ') || '-')}
        </TableCell>
      </TableRow>
    );
  };

  const activeFilters = (projectFilter !== 'ALL' ? 1 : 0) + (search ? 1 : 0);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FileCheck}
        iconGradient="linear-gradient(135deg, #ea580c, #f97316)"
        title="증빙/정산 관리"
        description="증빙 미완료 거래 추적 · 승인 대기 관리"
        badge={stats.missing > 0 ? `${stats.missing}건 긴급` : undefined}
        badgeVariant={stats.missing > 0 ? 'default' : 'secondary'}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: AlertTriangle, label: '증빙 미제출', value: stats.missing, color: '#e11d48', bgColor: '#e11d4810' },
          { icon: Paperclip, label: '일부 제출', value: stats.partial, color: '#d97706', bgColor: '#d9770610' },
          { icon: Clock, label: '승인 대기', value: stats.pending, color: '#ea580c', bgColor: '#ea580c10' },
          { icon: XCircle, label: '반려', value: stats.rejected, color: '#dc2626', bgColor: '#dc262610' },
        ].map(s => (
          <Card key={s.label} className="shadow-sm border-border/40 overflow-hidden">
            <CardContent className="p-0">
              <div className="p-4 relative">
                <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: s.color }} />
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: s.bgColor }}>
                    <s.icon className="w-4.5 h-4.5" style={{ color: s.color }} />
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground" style={{ fontWeight: 500 }}>{s.label}</p>
                    <p className="text-[20px]" style={{ fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                      {s.value}<span className="text-[12px]" style={{ fontWeight: 500 }}>건</span>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
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
        <div className="relative min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input
            className="h-8 pl-8 text-[11px]"
            placeholder="거래처/프로젝트 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground" onClick={() => { setProjectFilter('ALL'); setSearch(''); }}>
            초기화
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="incomplete" className="gap-1.5 text-[11px]">
            <AlertTriangle className="w-3 h-3" />
            증빙 미완료
            {incompleteTx.length > 0 && (
              <span className="ml-1 min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center px-1" style={{ fontWeight: 700 }}>
                {incompleteTx.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5 text-[11px]">
            <Clock className="w-3 h-3" />
            승인 대기
            {pendingTx.length > 0 && (
              <span className="ml-1 text-[10px] text-amber-600" style={{ fontWeight: 600 }}>{pendingTx.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="rejected" className="gap-1.5 text-[11px]">
            <XCircle className="w-3 h-3" />
            반려
            {rejectedTx.length > 0 && (
              <span className="ml-1 text-[10px] text-rose-600" style={{ fontWeight: 600 }}>{rejectedTx.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Incomplete */}
        <TabsContent value="incomplete">
          <Card className="shadow-sm border-border/50">
            <CardContent className="pt-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">일자</TableHead>
                      <TableHead className="text-[10px] min-w-[100px]">프로젝트</TableHead>
                      <TableHead className="text-[10px]">원장</TableHead>
                      <TableHead className="text-[10px]">거래처</TableHead>
                      <TableHead className="text-[10px]">항목</TableHead>
                      <TableHead className="text-right text-[10px]">금액</TableHead>
                      <TableHead className="text-[10px]">증빙</TableHead>
                      <TableHead className="text-[10px]">상태</TableHead>
                      <TableHead className="text-[10px] text-center">드라이브</TableHead>
                      <TableHead className="text-[10px]">미제출</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {incompleteTx.map(t => renderTxRow(t))}
                    {incompleteTx.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-[13px] text-muted-foreground">
                          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-300" />
                          모든 증빙이 완료되었습니다
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pending */}
        <TabsContent value="pending">
          <Card className="shadow-sm border-border/50">
            <CardContent className="pt-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">일자</TableHead>
                      <TableHead className="text-[10px] min-w-[100px]">프로젝트</TableHead>
                      <TableHead className="text-[10px]">원장</TableHead>
                      <TableHead className="text-[10px]">거래처</TableHead>
                      <TableHead className="text-[10px]">항목</TableHead>
                      <TableHead className="text-right text-[10px]">금액</TableHead>
                      <TableHead className="text-[10px]">증빙</TableHead>
                      <TableHead className="text-[10px]">상태</TableHead>
                      <TableHead className="text-[10px] text-center">드라이브</TableHead>
                      <TableHead className="text-[10px]">미제출</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingTx.map(t => renderTxRow(t))}
                    {pendingTx.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-[13px] text-muted-foreground">
                          승인 대기 거래가 없습니다
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Rejected */}
        <TabsContent value="rejected">
          <Card className="shadow-sm border-border/50">
            <CardContent className="pt-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">일자</TableHead>
                      <TableHead className="text-[10px] min-w-[100px]">프로젝트</TableHead>
                      <TableHead className="text-[10px]">원장</TableHead>
                      <TableHead className="text-[10px]">거래처</TableHead>
                      <TableHead className="text-[10px]">항목</TableHead>
                      <TableHead className="text-right text-[10px]">금액</TableHead>
                      <TableHead className="text-[10px]">증빙</TableHead>
                      <TableHead className="text-[10px]">상태</TableHead>
                      <TableHead className="text-[10px] text-center">드라이브</TableHead>
                      <TableHead className="text-[10px]">반려 사유</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rejectedTx.map(t => renderTxRow(t, true))}
                    {rejectedTx.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-10 text-[13px] text-muted-foreground">
                          반려된 거래가 없습니다
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}