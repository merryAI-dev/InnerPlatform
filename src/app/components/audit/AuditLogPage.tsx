import React, { useMemo, useState } from 'react';
import {
  BookOpen, Shield, Clock, User, FileText, FolderKanban,
  Search, Filter, CheckCircle2, XCircle, AlertTriangle,
  ArrowUpDown, ChevronDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { useAppStore } from '../../data/store';
import { PageHeader } from '../layout/PageHeader';

const entityIcons: Record<string, React.ReactNode> = {
  project: <FolderKanban className="w-3 h-3" />,
  ledger: <BookOpen className="w-3 h-3" />,
  transaction: <FileText className="w-3 h-3" />,
  evidence: <Shield className="w-3 h-3" />,
  comment: <FileText className="w-3 h-3" />,
  part_entry: <Shield className="w-3 h-3" />,
  part_project: <FolderKanban className="w-3 h-3" />,
  employee: <User className="w-3 h-3" />,
  member: <User className="w-3 h-3" />,
};

const entityLabels: Record<string, string> = {
  project: '프로젝트',
  ledger: '원장',
  transaction: '거래',
  evidence: '증빙',
  comment: '코멘트',
  part_entry: '참여율 배정',
  part_project: '참여율 사업',
  employee: '직원',
  member: '멤버',
  system: '시스템',
};

const actionStyles: Record<string, { bg: string; text: string; icon: any }> = {
  CREATE: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle2 },
  UPDATE: { bg: 'bg-blue-50', text: 'text-blue-700', icon: ArrowUpDown },
  APPROVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle2 },
  REJECT: { bg: 'bg-rose-50', text: 'text-rose-700', icon: XCircle },
  DELETE: { bg: 'bg-slate-100 dark:bg-slate-800/50', text: 'text-slate-600 dark:text-slate-400', icon: XCircle },
};

const actionLabels: Record<string, string> = {
  CREATE: '생성',
  UPDATE: '수정',
  APPROVE: '승인',
  REJECT: '반려',
  DELETE: '삭제',
};

export function AuditLogPage() {
  const { auditLogs, transactions, projects } = useAppStore();
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [showCount, setShowCount] = useState(30);

  const allLogs = useMemo(() => {
    const logs = [...auditLogs];

    transactions.forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      if (t.state === 'APPROVED' && t.approvedAt) {
        logs.push({
          id: `auto-${t.id}-approve`,
          entityType: 'transaction',
          entityId: t.id,
          action: 'APPROVE',
          userId: t.approvedBy || '',
          userName: t.approvedBy === 'u001' ? '김재무' : '시스템',
          details: `거래 승인: ${t.counterparty} ${t.amounts.bankAmount.toLocaleString()}원 (${proj?.name || ''})`,
          timestamp: t.approvedAt,
        });
      }
      if (t.state === 'SUBMITTED' && t.submittedAt) {
        logs.push({
          id: `auto-${t.id}-submit`,
          entityType: 'transaction',
          entityId: t.id,
          action: 'UPDATE',
          userId: t.submittedBy || '',
          userName: t.submittedBy === 'u002' ? '이프로' : '작성자',
          details: `거래 제출: ${t.counterparty} (${proj?.name || ''})`,
          timestamp: t.submittedAt,
        });
      }
      if (t.state === 'REJECTED') {
        logs.push({
          id: `auto-${t.id}-reject`,
          entityType: 'transaction',
          entityId: t.id,
          action: 'REJECT',
          userId: '',
          userName: '시스템',
          details: `거래 반려: ${t.counterparty} — ${t.rejectedReason || '사유 없음'}`,
          timestamp: t.dateTime,
        });
      }
    });

    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [auditLogs, transactions, projects]);

  const filtered = useMemo(() => {
    return allLogs.filter(log => {
      if (actionFilter !== 'ALL' && log.action !== actionFilter) return false;
      if (entityFilter !== 'ALL' && log.entityType !== entityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!log.details.toLowerCase().includes(q) &&
            !log.userName.toLowerCase().includes(q) &&
            !log.entityType.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allLogs, actionFilter, entityFilter, search]);

  const displayed = filtered.slice(0, showCount);

  // Stats
  const stats = useMemo(() => ({
    total: allLogs.length,
    creates: allLogs.filter(l => l.action === 'CREATE').length,
    approves: allLogs.filter(l => l.action === 'APPROVE').length,
    rejects: allLogs.filter(l => l.action === 'REJECT').length,
  }), [allLogs]);

  // Group by date for timeline display
  const grouped = useMemo(() => {
    const map = new Map<string, typeof displayed>();
    displayed.forEach(log => {
      const date = log.timestamp.slice(0, 10);
      if (!map.has(date)) map.set(date, []);
      map.get(date)!.push(log);
    });
    return map;
  }, [displayed]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BookOpen}
        iconGradient="linear-gradient(135deg, #7c3aed, #a78bfa)"
        title="감사 로그"
        description="모든 데이터 변경 이력 추적 · 읽기 전용"
        badge={`${allLogs.length}건`}
      />

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '전체 이력', value: stats.total, color: '#64748b' },
          { label: '생성', value: stats.creates, color: '#059669' },
          { label: '승인', value: stats.approves, color: '#0d9488' },
          { label: '반려', value: stats.rejects, color: '#e11d48' },
        ].map(s => (
          <div key={s.label} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card shadow-sm">
            <div className="w-1.5 h-8 rounded-full" style={{ background: s.color }} />
            <div>
              <p className="text-[10px] text-muted-foreground" style={{ fontWeight: 500 }}>{s.label}</p>
              <p className="text-[16px]" style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: s.color }}>{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-border/40 bg-card shadow-sm">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span style={{ fontWeight: 500 }}>필터</span>
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input
            className="h-8 pl-8 text-[11px]"
            placeholder="검색 (사용자, 내용, 유형)..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-8 w-[110px] text-[11px]"><SelectValue placeholder="액션" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 액션</SelectItem>
            {Object.entries(actionLabels).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-[11px]">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="h-8 w-[110px] text-[11px]"><SelectValue placeholder="대상" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 대상</SelectItem>
            {Object.entries(entityLabels).map(([k, v]) => (
              <SelectItem key={k} value={k} className="text-[11px]">{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {filtered.length}건 표시 중
        </span>
      </div>

      {/* Timeline View */}
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([date, logs]) => (
          <div key={date}>
            {/* Date header */}
            <div className="flex items-center gap-2 mb-2 sticky top-0 z-10 bg-background py-1">
              <div className="w-2 h-2 rounded-full bg-indigo-400" />
              <span className="text-[11px] text-indigo-600" style={{ fontWeight: 700 }}>
                {date.replace(/-/g, '.')}
              </span>
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[9px] text-muted-foreground">{logs.length}건</span>
            </div>

            <div className="space-y-1 ml-1 pl-3 border-l-2 border-border/30">
              {logs.map(log => {
                const as = actionStyles[log.action] || actionStyles.CREATE;
                const ActionIcon = as.icon;
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/30 transition-colors group relative"
                  >
                    {/* Timeline dot */}
                    <div className="absolute -left-[17px] top-3.5 w-2 h-2 rounded-full bg-card border-2 border-border/60 group-hover:border-indigo-400 transition-colors" />

                    {/* Entity icon */}
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${as.bg}`}>
                      {entityIcons[log.entityType] || <FileText className="w-3 h-3" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md ${as.bg} ${as.text}`} style={{ fontWeight: 600 }}>
                          <ActionIcon className="w-2.5 h-2.5" />
                          {actionLabels[log.action] || log.action}
                        </span>
                        <span className="text-[9px] text-muted-foreground/70 px-1.5 py-0.5 bg-muted/50 rounded" style={{ fontWeight: 500 }}>
                          {entityLabels[log.entityType] || log.entityType}
                        </span>
                        <span className="text-[9px] text-muted-foreground/50 ml-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {log.timestamp.slice(11, 19) || log.timestamp.slice(11)}
                        </span>
                      </div>
                      <p className="text-[11px] text-foreground/80 mt-1 line-clamp-2">{log.details}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <User className="w-2.5 h-2.5 text-muted-foreground/40" />
                        <span className="text-[9px] text-muted-foreground/60">{log.userName}</span>
                        <span className="text-[8px] text-muted-foreground/30 font-mono ml-1">{log.entityId.slice(0, 8)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Load more */}
      {filtered.length > showCount && (
        <div className="text-center py-3">
          <Button
            variant="outline"
            size="sm"
            className="text-[11px] gap-1.5"
            onClick={() => setShowCount(c => c + 30)}
          >
            <ChevronDown className="w-3 h-3" />
            더보기 ({filtered.length - showCount}건 남음)
          </Button>
        </div>
      )}
    </div>
  );
}
