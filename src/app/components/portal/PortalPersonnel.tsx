import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Users, UserPlus, Percent, ArrowRight,
  Building2, Briefcase, Clock, AlertTriangle, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { PageHeader } from '../layout/PageHeader';
import { usePortalStore } from '../../data/portal-store';
import {
  SETTLEMENT_SYSTEM_SHORT,
} from '../../data/types';

// ═══════════════════════════════════════════════════════════════
// PortalPersonnel — 내 사업 인력 현황
// ═══════════════════════════════════════════════════════════════

export function PortalPersonnel() {
  const navigate = useNavigate();
  const { isLoading, myProject, participationEntries } = usePortalStore();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-5 h-5 mx-auto animate-spin text-muted-foreground" />
          <p className="mt-2 text-[12px] text-muted-foreground">인력 현황을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!myProject) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-[14px] text-muted-foreground">사업이 선택되지 않았습니다.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/portal/project-settings')}>
          사업 선택하기
        </Button>
      </div>
    );
  }

  // 내 사업에 배정된 인력
  const myEntries = useMemo(() => {
    return participationEntries.filter(e => e.projectId === myProject.id);
  }, [myProject.id, participationEntries]);

  // 멤버별 그룹핑
  const members = useMemo(() => {
    const map = new Map<string, { name: string; entries: typeof myEntries }>();
    myEntries.forEach(e => {
      if (!map.has(e.memberId)) map.set(e.memberId, { name: e.memberName, entries: [] });
      map.get(e.memberId)!.entries.push(e);
    });
    return Array.from(map.entries()).map(([id, v]) => ({
      id,
      name: v.name,
      entries: v.entries,
      totalRate: v.entries.reduce((s, e) => s + e.rate, 0),
    }));
  }, [myEntries]);

  const totalHeadcount = members.length;
  const avgRate = members.length > 0
    ? members.reduce((s, m) => s + m.totalRate, 0) / members.length
    : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        iconGradient="linear-gradient(135deg, #059669 0%, #0d9488 100%)"
        title="인력 현황"
        description={myProject ? `${myProject.name} 투입 인력` : '인력 현황'}
        badge={`${totalHeadcount}명`}
        actions={
          <Button size="sm" className="h-8 text-[12px] gap-1.5" onClick={() => navigate('/portal/change-requests')}>
            <ArrowRight className="w-3.5 h-3.5" /> 인력변경 신청
          </Button>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-teal-100 dark:bg-teal-900/50">
              <Users className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">투입 인원</p>
              <p className="text-[16px]" style={{ fontWeight: 700 }}>{totalHeadcount}명</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-indigo-100 dark:bg-indigo-900/50">
              <Percent className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">평균 투입율</p>
              <p className="text-[16px]" style={{ fontWeight: 700 }}>{avgRate.toFixed(0)}%</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-amber-100 dark:bg-amber-900/50">
              <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">총 참여율 합계</p>
              <p className="text-[16px]" style={{ fontWeight: 700 }}>{myEntries.reduce((s, e) => s + e.rate, 0)}%</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 인력 리스트 */}
      {members.length === 0 ? (
        <Card className="p-8 text-center">
          <Users className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-[13px] text-muted-foreground">이 사업에 배정된 인력이 없습니다</p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">인력변경 신청을 통해 인력을 추가할 수 있습니다</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {members.map(m => (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[12px] text-white shrink-0"
                      style={{ fontWeight: 700, background: 'linear-gradient(135deg, #0d9488, #059669)' }}
                    >
                      {m.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-[13px]" style={{ fontWeight: 600 }}>{m.name}</p>
                      <p className="text-[10px] text-muted-foreground">{m.entries.length}개 항목</p>
                    </div>
                  </div>
                  <Badge
                    className={`text-[10px] h-5 px-2 ${
                      m.totalRate > 100 ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300' :
                      m.totalRate > 80 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' :
                      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
                    }`}
                  >
                    투입율 {m.totalRate}%
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  {m.entries.map(e => (
                    <div key={e.id} className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-[10px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="text-[8px] h-3.5 px-1 shrink-0">
                          {SETTLEMENT_SYSTEM_SHORT[e.settlementSystem]}
                        </Badge>
                        <span className="truncate">{e.clientOrg}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{e.rate}%</span>
                        <span className="text-muted-foreground">{e.periodStart}~{e.periodEnd}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
