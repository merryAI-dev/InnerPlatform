import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Bell, X, Clock, AlertTriangle, CheckCircle2, FileText,
  Shield, ChevronRight, Users, ExternalLink, Filter,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useAppStore } from '../../data/store';
import { computeMemberSummaries } from '../../data/participation-data';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { getSeoulTodayIso } from '../../platform/business-days';
import { findWeekForDate, getMonthMondayWeeks } from '../../platform/cashflow-weeks';

interface NotifItem {
  id: string;
  type: 'approval' | 'evidence' | 'risk' | 'system';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  timestamp: string;
  link?: string;
  read: boolean;
}

export function NotificationPanel() {
  const navigate = useNavigate();
  const { transactions, projects, participationEntries } = useAppStore();
  const { weeks: cashflowWeeks } = useCashflowWeeks();
  const [open, setOpen] = useState(false);

  const today = getSeoulTodayIso();
  const dayOfWeek = new Date(today).getDay(); // 0=Sun..6=Sat

  const notifications = useMemo<NotifItem[]>(() => {
    const items: NotifItem[] = [];

    // Pending approvals
    const pending = transactions.filter(t => t.state === 'SUBMITTED');
    pending.forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      items.push({
        id: `approval-${t.id}`,
        type: 'approval',
        severity: 'warning',
        title: '승인 대기 거래',
        description: `${t.counterparty} — ${t.amounts.bankAmount.toLocaleString()}원 (${proj?.name || ''})`,
        timestamp: t.submittedAt || t.dateTime,
        link: proj ? `/projects/${proj.id}` : undefined,
        read: false,
      });
    });

    // Missing evidence
    const missingEvi = transactions.filter(t => t.evidenceStatus === 'MISSING' && t.state !== 'REJECTED');
    missingEvi.slice(0, 5).forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      items.push({
        id: `evidence-${t.id}`,
        type: 'evidence',
        severity: 'warning',
        title: '증빙 미제출',
        description: `${t.counterparty} — ${proj?.name || ''}`,
        timestamp: t.dateTime,
        link: '/evidence',
        read: false,
      });
    });

    // Participation risks
    const summaries = computeMemberSummaries(participationEntries);
    const dangers = summaries.filter(m => m.riskLevel === 'DANGER');
    dangers.forEach(m => {
      items.push({
        id: `risk-${m.memberId}`,
        type: 'risk',
        severity: 'critical',
        title: '참여율 초과 위험',
        description: `${m.realName}(${m.nickname}) — 전체 ${m.totalRate}%`,
        timestamp: new Date().toISOString(),
        link: '/participation',
        read: false,
      });
    });

    // Rejected transactions
    const rejected = transactions.filter(t => t.state === 'REJECTED');
    rejected.forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      items.push({
        id: `rejected-${t.id}`,
        type: 'system',
        severity: 'critical',
        title: '거래 반려됨',
        description: `${t.counterparty} — ${t.rejectedReason || '사유 없음'} (${proj?.name || ''})`,
        timestamp: t.dateTime,
        link: proj ? `/projects/${proj.id}` : undefined,
        read: false,
      });
    });

    // Weekly deadline reminder (Thu=4, Fri=5)
    if (dayOfWeek === 4 || dayOfWeek === 5) {
      const monthWeeks = getMonthMondayWeeks(today.slice(0, 7));
      const currentWeek = findWeekForDate(today, monthWeeks);
      if (currentWeek) {
        const activeProjectIds = projects
          .filter(p => p.phase === 'CONFIRMED' && p.status === 'IN_PROGRESS')
          .map(p => p.id);
        const thisWeekTxProjectIds = new Set(
          transactions
            .filter(t => t.dateTime >= currentWeek.weekStart && t.dateTime <= currentWeek.weekEnd)
            .map(t => t.projectId),
        );
        const thisWeekSheetProjectIds = new Set(
          cashflowWeeks
            .filter(w => w.yearMonth === today.slice(0, 7) && w.weekNo === currentWeek.weekNo)
            .map(w => w.projectId),
        );
        const missingIds = activeProjectIds.filter(
          pid => !thisWeekTxProjectIds.has(pid) && !thisWeekSheetProjectIds.has(pid),
        );
        if (missingIds.length > 0) {
          items.push({
            id: 'deadline-weekly',
            type: 'system',
            severity: 'warning',
            title: '주간 마감 임박',
            description: `미입력 사업 ${missingIds.length}건 — 금주 사업비 입력을 완료해주세요`,
            timestamp: today,
            link: '/cashflow',
            read: false,
          });
        }
      }
    }

    // Variance flags (OPEN)
    const openFlags = cashflowWeeks.filter(w => w.varianceFlag?.status === 'OPEN');
    openFlags.forEach(w => {
      const proj = projects.find(p => p.id === w.projectId);
      items.push({
        id: `vflag-${w.id}`,
        type: 'system',
        severity: 'critical',
        title: '편차 플래그 확인요청',
        description: `${proj?.name || w.projectId} — ${w.yearMonth} ${w.weekNo}주: "${w.varianceFlag?.reason || ''}"`,
        timestamp: w.varianceFlag?.flaggedAt || today,
        link: '/cashflow',
        read: false,
      });
    });

    // Approved transactions notification (info)
    const recentApproved = transactions.filter(t => t.state === 'APPROVED' && t.approvedAt);
    recentApproved.slice(0, 3).forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      items.push({
        id: `approved-${t.id}`,
        type: 'approval',
        severity: 'info',
        title: '거래 승인됨',
        description: `${t.counterparty} — ${t.amounts.bankAmount.toLocaleString()}원 (${proj?.name || ''})`,
        timestamp: t.approvedAt || t.dateTime,
        link: '/evidence',
        read: false,
      });
    });

    return items.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }, [transactions, projects, participationEntries, cashflowWeeks, today, dayOfWeek]);

  const criticalCount = notifications.filter(n => n.severity === 'critical').length;
  const totalCount = notifications.length;

  const typeIcons = {
    approval: Clock,
    evidence: FileText,
    risk: Shield,
    system: AlertTriangle,
  };

  const severityStyles = {
    critical: { dot: 'bg-rose-500', bg: 'bg-rose-500/10 dark:bg-rose-500/15', border: 'border-l-rose-500' },
    warning: { dot: 'bg-amber-500', bg: 'bg-amber-500/10 dark:bg-amber-500/15', border: 'border-l-amber-500' },
    info: { dot: 'bg-blue-500', bg: 'bg-blue-500/10 dark:bg-blue-500/15', border: 'border-l-blue-500' },
  };

  const fallbackByType: Record<NotifItem['type'], string> = {
    approval: '/approvals',
    evidence: '/evidence',
    risk: '/participation',
    system: '/approvals',
  };

  const handleGo = (notif: NotifItem) => {
    const target = notif.link || fallbackByType[notif.type];
    navigate(target);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="relative h-8 w-8 p-0">
          <Bell className="w-4 h-4 text-slate-500" />
          {totalCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center px-0.5"
              style={{ fontWeight: 700 }}
            >
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="glass-heavy w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-glass-border">
          <div className="flex items-center justify-between mb-1">
            <SheetTitle className="text-[15px]" style={{ fontWeight: 700 }}>알림 센터</SheetTitle>
            <div className="flex items-center gap-2">
              {criticalCount > 0 && (
                <Badge className="border border-rose-300/40 bg-rose-500/30 text-rose-100 text-[10px]" style={{ fontWeight: 700 }}>
                  긴급 {criticalCount}
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">{totalCount}건</Badge>
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">승인 대기, 증빙 미제출, 위험 알림을 한곳에서 확인하세요.</p>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-4 pt-3">
            <TabsList className="w-full h-8">
              <TabsTrigger value="all" className="text-[11px] flex-1">전체 ({totalCount})</TabsTrigger>
              <TabsTrigger value="critical" className="text-[11px] flex-1">긴급 ({criticalCount})</TabsTrigger>
              <TabsTrigger value="approval" className="text-[11px] flex-1">
                승인 ({notifications.filter(n => n.type === 'approval').length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="flex-1 overflow-y-auto mt-0 px-3 py-2 space-y-1.5">
            {notifications.length === 0 && (
              <div className="text-center py-12 text-[13px] text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-300" />
                처리할 알림이 없습니다
              </div>
            )}
            {notifications.map(n => {
              const Icon = typeIcons[n.type];
              const sev = severityStyles[n.severity];
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-white/10 ${sev.border} ${sev.bg}`}
                  onClick={() => handleGo(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/40 dark:bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px]" style={{ fontWeight: 600 }}>{n.title}</span>
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev.dot}`} />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.description}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">{n.timestamp.slice(0, 10)}</p>
                  </div>
                  {n.link && (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-1" />
                  )}
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="critical" className="flex-1 overflow-y-auto mt-0 px-3 py-2 space-y-1.5">
            {notifications.filter(n => n.severity === 'critical').map(n => {
              const Icon = typeIcons[n.type];
              const sev = severityStyles[n.severity];
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-white/10 ${sev.border} ${sev.bg}`}
                  onClick={() => handleGo(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/40 dark:bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-rose-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px]" style={{ fontWeight: 600 }}>{n.title}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{n.description}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-1" />
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="approval" className="flex-1 overflow-y-auto mt-0 px-3 py-2 space-y-1.5">
            {notifications.filter(n => n.type === 'approval').map(n => {
              const sev = severityStyles[n.severity];
              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-white/10 ${sev.border} ${sev.bg}`}
                  onClick={() => handleGo(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/40 dark:bg-white/10 backdrop-blur-sm flex items-center justify-center shrink-0 border border-white/20 mt-0.5">
                    <Clock className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px]" style={{ fontWeight: 600 }}>{n.title}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{n.description}</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0 mt-1" />
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
