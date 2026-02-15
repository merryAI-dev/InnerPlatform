import { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { listenNotificationsForRecipient, type PlatformNotificationDoc } from '../../lib/notifications-service';

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

const SEEN_STORAGE_KEY = 'mysc-notifications-seen-v1';

function loadSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return new Set();
    return new Set(Object.keys(parsed));
  } catch {
    return new Set();
  }
}

function markSeen(id: string) {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[id] = new Date().toISOString();
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // no-op
  }
}

export function NotificationPanel() {
  const navigate = useNavigate();
  const { transactions, projects, participationEntries } = useAppStore();
  const { user } = useAuth();
  const { db, isOnline, orgId } = useFirebase();
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<PlatformNotificationDoc[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadSeenIds());

  const firestoreEnabled = featureFlags.firestoreCoreEnabled && isOnline && !!db && !!user?.uid;

  useEffect(() => {
    if (!firestoreEnabled || !db || !user?.uid) {
      setFeed([]);
      return;
    }
    return listenNotificationsForRecipient(db, orgId, user.uid, (items) => setFeed(items));
  }, [firestoreEnabled, db, orgId, user?.uid]);

  const notifications = useMemo<NotifItem[]>(() => {
    const items: NotifItem[] = [];

    // Activity feed (outbox-backed notifications)
    feed.forEach((n) => {
      const state = String(n.state || '').toUpperCase();
      const type: NotifItem['type'] = state === 'SUBMITTED' ? 'approval' : 'system';
      const severity = n.severity || (state === 'REJECTED' ? 'critical' : state === 'SUBMITTED' ? 'warning' : 'info');
      const link = state === 'SUBMITTED'
        ? '/approvals'
        : n.projectId
          ? `/projects/${n.projectId}`
          : undefined;

      items.push({
        id: n.id,
        type,
        severity,
        title: n.title,
        description: n.description,
        timestamp: n.createdAt,
        link,
        read: seenIds.has(n.id),
      });
    });

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

    return items.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      if (sev !== 0) return sev;
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });
  }, [feed, seenIds, transactions, projects, participationEntries]);

  const criticalCount = notifications.filter(n => n.severity === 'critical').length;
  const totalCount = notifications.length;

  const typeIcons = {
    approval: Clock,
    evidence: FileText,
    risk: Shield,
    system: AlertTriangle,
  };

  const severityStyles = {
    critical: { dot: 'bg-rose-500', bg: 'bg-rose-50/50', border: 'border-l-rose-500' },
    warning: { dot: 'bg-amber-500', bg: 'bg-amber-50/30', border: 'border-l-amber-500' },
    info: { dot: 'bg-blue-500', bg: 'bg-blue-50/30', border: 'border-l-blue-500' },
  };

  const handleGo = (link?: string) => {
    if (link) {
      navigate(link);
      setOpen(false);
    }
  };

  const handleClickItem = (item: NotifItem) => {
    if (!item.read) {
      markSeen(item.id);
      setSeenIds((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    }
    handleGo(item.link);
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
      <SheetContent className="w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border/60">
          <div className="flex items-center justify-between mb-1">
            <SheetTitle className="text-[15px]" style={{ fontWeight: 700 }}>알림 센터</SheetTitle>
            <div className="flex items-center gap-2">
              {criticalCount > 0 && (
                <Badge className="bg-rose-500 text-white text-[10px]" style={{ fontWeight: 700 }}>
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
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-muted/40 ${sev.border} ${sev.bg}`}
                  onClick={() => handleClickItem(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/80 flex items-center justify-center shrink-0 border border-border/40 mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px]" style={{ fontWeight: 600 }}>{n.title}</span>
                      {!n.read && <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sev.dot}`} />}
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
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-muted/40 ${sev.border} ${sev.bg}`}
                  onClick={() => handleClickItem(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/80 flex items-center justify-center shrink-0 border border-border/40 mt-0.5">
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
                  className={`flex items-start gap-3 p-3 rounded-lg border-l-[3px] cursor-pointer transition-colors hover:bg-muted/40 ${sev.border} ${sev.bg}`}
                  onClick={() => handleClickItem(n)}
                >
                  <div className="w-7 h-7 rounded-md bg-white/80 flex items-center justify-center shrink-0 border border-border/40 mt-0.5">
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
