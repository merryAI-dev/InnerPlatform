import { useMemo } from 'react';
import {
  Activity, CheckCircle2, AlertTriangle, XCircle,
  Database, Shield, FileText, Clock, ArrowUp, ArrowDown,
  TrendingUp, Server, Zap,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Progress } from '../ui/progress';
import { useAppStore } from '../../data/store';
import { computeMemberSummaries } from '../../data/participation-data';

interface HealthMetric {
  id: string;
  label: string;
  icon: any;
  status: 'healthy' | 'warning' | 'critical';
  value: string;
  detail: string;
  progress?: number;
}

export function SystemHealthPanel() {
  const { projects, transactions, ledgers, participationEntries, dataSource } = useAppStore();

  const metrics = useMemo<HealthMetric[]>(() => {
    const confirmed = projects.filter(p => p.phase === 'CONFIRMED');
    const withLedger = confirmed.filter(p => ledgers.some(l => l.projectId === p.id));
    const ledgerCoverage = confirmed.length > 0 ? Math.round((withLedger.length / confirmed.length) * 100) : 100;

    const approvedTx = transactions.filter(t => t.state === 'APPROVED');
    const completeTx = approvedTx.filter(t => t.evidenceStatus === 'COMPLETE');
    const evidenceCoverage = approvedTx.length > 0 ? Math.round((completeTx.length / approvedTx.length) * 100) : 100;

    const pendingCount = transactions.filter(t => t.state === 'SUBMITTED').length;
    const rejectedCount = transactions.filter(t => t.state === 'REJECTED').length;

    const summaries = computeMemberSummaries(participationEntries);
    const dangerCount = summaries.filter(m => m.riskLevel === 'DANGER').length;
    const warningCount = summaries.filter(m => m.riskLevel === 'WARNING').length;

    return [
      {
        id: 'data-source',
        label: '데이터 소스',
        icon: Database,
        status: dataSource === 'firestore' ? 'healthy' : 'warning',
        value: dataSource === 'firestore' ? '실시간 동기화' : '로컬 모드',
        detail: dataSource === 'firestore' ? 'Firestore 연결 정상' : 'Firebase 미연결',
      },
      {
        id: 'ledger-coverage',
        label: '원장 연결률',
        icon: FileText,
        status: ledgerCoverage >= 90 ? 'healthy' : ledgerCoverage >= 70 ? 'warning' : 'critical',
        value: `${ledgerCoverage}%`,
        detail: `${withLedger.length}/${confirmed.length} 사업 원장 연결`,
        progress: ledgerCoverage,
      },
      {
        id: 'evidence-coverage',
        label: '증빙 완료율',
        icon: Shield,
        status: evidenceCoverage >= 80 ? 'healthy' : evidenceCoverage >= 50 ? 'warning' : 'critical',
        value: `${evidenceCoverage}%`,
        detail: `${completeTx.length}/${approvedTx.length} 승인 거래 증빙 완료`,
        progress: evidenceCoverage,
      },
      {
        id: 'pending-approvals',
        label: '승인 대기',
        icon: Clock,
        status: pendingCount === 0 ? 'healthy' : pendingCount <= 3 ? 'warning' : 'critical',
        value: `${pendingCount}건`,
        detail: pendingCount === 0 ? '미처리 건 없음' : `${pendingCount}건 승인 필요`,
      },
      {
        id: 'participation-risk',
        label: '참여율 위험',
        icon: AlertTriangle,
        status: dangerCount === 0 ? (warningCount === 0 ? 'healthy' : 'warning') : 'critical',
        value: dangerCount > 0 ? `${dangerCount}명 위험` : warningCount > 0 ? `${warningCount}명 주의` : '정상',
        detail: dangerCount > 0 ? `${dangerCount}명 100% 초과` : '위험 인원 없음',
      },
      {
        id: 'rejected-tx',
        label: '반려 거래',
        icon: XCircle,
        status: rejectedCount === 0 ? 'healthy' : 'critical',
        value: `${rejectedCount}건`,
        detail: rejectedCount === 0 ? '반려 건 없음' : `${rejectedCount}건 재처리 필요`,
      },
    ];
  }, [projects, transactions, ledgers, participationEntries, dataSource]);

  const overallHealth = useMemo(() => {
    const criticals = metrics.filter(m => m.status === 'critical').length;
    const warnings = metrics.filter(m => m.status === 'warning').length;
    if (criticals > 0) return { label: '조치 필요', color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', icon: XCircle };
    if (warnings > 0) return { label: '주의 필요', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle };
    return { label: '정상 운영', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle2 };
  }, [metrics]);

  const statusDot = {
    healthy: 'bg-emerald-500',
    warning: 'bg-amber-500',
    critical: 'bg-rose-500',
  };

  const statusBg = {
    healthy: 'bg-emerald-50/50',
    warning: 'bg-amber-50/50',
    critical: 'bg-rose-50/50',
  };

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[13px] flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-slate-600" />
            </div>
            시스템 상태
          </CardTitle>
          <div className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border ${overallHealth.bg} ${overallHealth.border} ${overallHealth.color}`} style={{ fontWeight: 600 }}>
            <overallHealth.icon className="w-3 h-3" />
            {overallHealth.label}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {metrics.map(m => (
          <div key={m.id} className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${statusBg[m.status]}`}>
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[m.status]}`} />
            <m.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-700" style={{ fontWeight: 500 }}>{m.label}</span>
                <span className="text-[11px]" style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{m.value}</span>
              </div>
              {m.progress !== undefined && (
                <div className="mt-1">
                  <Progress value={m.progress} className="h-1" />
                </div>
              )}
              <p className="text-[9px] text-muted-foreground mt-0.5">{m.detail}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Activity Feed ──

interface ActivityItem {
  id: string;
  icon: any;
  iconColor: string;
  title: string;
  detail: string;
  timestamp: string;
  type: 'approval' | 'rejection' | 'creation' | 'evidence' | 'system';
}

export function ActivityFeed() {
  const { transactions, projects, auditLogs } = useAppStore();

  const activities = useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = [];

    // From transactions
    transactions.forEach(t => {
      const proj = projects.find(p => p.id === t.projectId);
      const projName = proj?.name || '';

      if (t.state === 'APPROVED' && t.approvedAt) {
        items.push({
          id: `appr-${t.id}`,
          icon: CheckCircle2,
          iconColor: 'text-emerald-500',
          title: '거래 승인',
          detail: `${t.counterparty} ${t.amounts.bankAmount.toLocaleString()}원 — ${projName}`,
          timestamp: t.approvedAt,
          type: 'approval',
        });
      }
      if (t.state === 'REJECTED') {
        items.push({
          id: `rej-${t.id}`,
          icon: XCircle,
          iconColor: 'text-rose-500',
          title: '거래 반려',
          detail: `${t.counterparty} — ${t.rejectedReason || '사유 미기입'}`,
          timestamp: t.dateTime,
          type: 'rejection',
        });
      }
      if (t.state === 'SUBMITTED' && t.submittedAt) {
        items.push({
          id: `sub-${t.id}`,
          icon: Clock,
          iconColor: 'text-amber-500',
          title: '승인 요청',
          detail: `${t.counterparty} ${t.amounts.bankAmount.toLocaleString()}원`,
          timestamp: t.submittedAt,
          type: 'creation',
        });
      }
    });

    return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 12);
  }, [transactions, projects]);

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-[13px] flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          최근 활동
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-border/60" />

          <div className="space-y-3">
            {activities.map((a, i) => (
              <div key={a.id} className="flex items-start gap-3 relative">
                <div className="w-[23px] h-[23px] rounded-full bg-white border-2 border-border/60 flex items-center justify-center shrink-0 z-10">
                  <a.icon className={`w-3 h-3 ${a.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px]" style={{ fontWeight: 600 }}>{a.title}</span>
                    <span className="text-[9px] text-muted-foreground whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {a.timestamp.slice(5, 16)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">{a.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}