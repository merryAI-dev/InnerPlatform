import { useMemo } from 'react';
import {
  Wifi, WifiOff, Database, Clock, Users, FolderKanban,
  Activity, CheckCircle2, AlertTriangle, Shield,
} from 'lucide-react';
import { useAppStore } from '../../data/store';
import { computeMemberSummaries } from '../../data/participation-data';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

function StatusItem({ icon: Icon, label, value, color, tooltip }: {
  icon: any; label: string; value: string | number; color?: string; tooltip?: string;
}) {
  const content = (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] rounded-sm bg-white/30 dark:bg-white/5 ${color || 'text-slate-500'}`}>
      <Icon className="w-3 h-3" />
      <span className="hidden xl:inline">{label}</span>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
  
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return content;
}

export function StatusBar() {
  const { projects, transactions, participationEntries, dataSource } = useAppStore();

  const stats = useMemo(() => {
    const activeProjects = projects.filter(p => p.phase === 'CONFIRMED' && p.status === 'IN_PROGRESS').length;
    const pendingApproval = transactions.filter(t => t.state === 'SUBMITTED').length;
    const missingEvidence = transactions.filter(t => t.evidenceStatus !== 'COMPLETE' && t.state !== 'REJECTED').length;
    const summaries = computeMemberSummaries(participationEntries);
    const dangerCount = summaries.filter(m => m.riskLevel === 'DANGER').length;
    const approvedToday = transactions.filter(t => t.state === 'APPROVED').length;

    return { activeProjects, pendingApproval, missingEvidence, dangerCount, approvedToday, totalProjects: projects.length };
  }, [projects, transactions, participationEntries]);

  const now = new Date();
  const timeStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div
      className="glass-light flex items-center justify-between h-[26px] border-t border-glass-border px-3 shrink-0 select-none"
    >
      {/* Left section */}
      <div className="flex items-center gap-0.5 divide-x divide-border/40">
        {/* Connection status */}
        <div className={`flex items-center gap-1 px-2 text-[10px] ${dataSource === 'firestore' ? 'text-emerald-600' : 'text-slate-400'}`}>
          {dataSource === 'firestore' ? (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span style={{ fontWeight: 500 }}>Firestore</span>
            </>
          ) : (
            <>
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span style={{ fontWeight: 500 }}>로컬</span>
            </>
          )}
        </div>

        <StatusItem
          icon={FolderKanban}
          label="사업"
          value={`${stats.activeProjects}/${stats.totalProjects}`}
          tooltip={`진행중 ${stats.activeProjects} / 전체 ${stats.totalProjects}`}
        />

        {stats.pendingApproval > 0 && (
          <StatusItem
            icon={Clock}
            label="승인대기"
            value={stats.pendingApproval}
            color="text-amber-600"
            tooltip={`${stats.pendingApproval}건 승인 대기 중`}
          />
        )}

        {stats.missingEvidence > 0 && (
          <StatusItem
            icon={AlertTriangle}
            label="증빙누락"
            value={stats.missingEvidence}
            color="text-orange-600"
            tooltip={`${stats.missingEvidence}건 증빙 미완료`}
          />
        )}

        {stats.dangerCount > 0 && (
          <StatusItem
            icon={Shield}
            label="참여율위험"
            value={stats.dangerCount}
            color="text-rose-600"
            tooltip={`${stats.dangerCount}명 참여율 100% 초과`}
          />
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-0.5 divide-x divide-border/40">
        <StatusItem
          icon={CheckCircle2}
          label="승인완료"
          value={stats.approvedToday}
          color="text-emerald-600"
          tooltip={`${stats.approvedToday}건 승인됨`}
        />
        <div className="flex items-center gap-1 px-2 text-[10px] text-slate-400">
          <Clock className="w-3 h-3" />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
        </div>
      </div>
    </div>
  );
}
