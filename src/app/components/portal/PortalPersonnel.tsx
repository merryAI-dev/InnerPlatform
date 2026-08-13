import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, ArrowRight, Clock, Loader2, Percent, Users } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { fetchProjectParticipationViaBff, isPlatformApiEnabled, type ProjectParticipationSnapshot } from '../../lib/platform-bff-client';

export function PortalPersonnel() {
  const navigate = useNavigate();
  const { isLoading, myProject } = usePortalStore();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [snapshot, setSnapshot] = useState<ProjectParticipationSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!myProject || !user || !isPlatformApiEnabled()) return;
    let cancelled = false;
    setError('');
    void fetchProjectParticipationViaBff({ tenantId: orgId, actor: user, projectId: myProject.id })
      .then((next) => { if (!cancelled) setSnapshot(next); })
      .catch(() => { if (!cancelled) setError('인력 현황을 불러오지 못했습니다.'); });
    return () => { cancelled = true; };
  }, [myProject, orgId, user]);

  if (isLoading || (myProject && !snapshot && !error)) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /><p className="mt-2 text-[12px] text-muted-foreground">인력 현황을 불러오는 중...</p></div></div>;
  }

  if (!myProject) {
    return <div className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" /><p className="text-[14px] text-muted-foreground">사업이 선택되지 않았습니다.</p><Button variant="outline" className="mt-4" onClick={() => navigate('/portal/project-select')}>사업 선택하기</Button></div>;
  }

  if (error || !snapshot) {
    return <div className="py-16 text-center"><AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" /><p className="text-[14px] text-muted-foreground">{error || '인력 현황을 표시할 수 없습니다.'}</p></div>;
  }

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} iconGradient="linear-gradient(135deg, #059669 0%, #0d9488 100%)" title="인력 현황" description={`${myProject.name} 투입 인력`} badge={`${snapshot.headcount}명`} headingVisible={false} actions={<Button size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => navigate('/portal/change-requests')}><ArrowRight className="h-3.5 w-3.5" /> 인력변경 신청</Button>} />
      <div className="grid grid-cols-3 gap-3">
        <Metric icon={Users} label="투입 인원" value={`${snapshot.headcount}명`} tone="teal" />
        <Metric icon={Percent} label="평균 참여율" value={`${snapshot.averageRate}%`} tone="cyan" />
        <Metric icon={Clock} label="총 참여율 합계" value={`${snapshot.totalRate}%`} tone="amber" />
      </div>
      {!snapshot.hasMembers ? (
        <Card className="p-8 text-center"><Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" /><p className="text-[13px] text-muted-foreground">이 사업에 배정된 인력이 없습니다</p><p className="mt-1 text-[11px] text-muted-foreground/60">인력변경 신청을 통해 인력을 추가할 수 있습니다</p></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{snapshot.members.map((member) => (
          <Card key={member.memberId} className="overflow-hidden"><CardContent className="p-4"><div className="mb-3 flex items-start justify-between gap-2"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-600 to-emerald-600 text-[12px] font-bold text-white">{member.memberName.charAt(0)}</div><div><p className="text-[13px] font-semibold">{member.memberName}</p><p className="text-[10px] text-muted-foreground">{member.entryCount}개 항목</p></div></div><Badge className={`h-5 px-2 text-[10px] ${member.isWarning ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'}`}>참여율 {member.totalRate}%</Badge></div><div className="space-y-1.5">{member.entries.map((entry) => <div key={entry.id} className="flex items-center justify-between rounded-md bg-muted/30 p-2 text-[10px]"><span className="truncate">{entry.clientOrg || entry.note || '-'}</span><div className="flex shrink-0 items-center gap-2"><span className="font-semibold tabular-nums">{entry.rate}%</span><span className="text-muted-foreground">{entry.periodStart}~{entry.periodEnd}</span></div></div>)}</div></CardContent></Card>
        ))}</div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Users; label: string; value: string; tone: 'teal' | 'cyan' | 'amber' }) {
  const colors = { teal: 'bg-teal-100 text-teal-600 dark:bg-teal-900/50 dark:text-teal-400', cyan: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/50 dark:text-cyan-400', amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400' };
  return <Card><CardContent className="flex items-center gap-2.5 p-3"><div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors[tone]}`}><Icon className="h-3.5 w-3.5" /></div><div><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-[16px] font-bold">{value}</p></div></CardContent></Card>;
}
