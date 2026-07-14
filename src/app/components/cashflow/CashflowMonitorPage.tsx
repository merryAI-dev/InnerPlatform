import { useMemo, type ComponentType } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity,
  ArrowRight,
  CalendarRange,
  FileSpreadsheet,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';

type MonitorLinkCardProps = {
  title: string;
  description: string;
  href: string;
  badge: string;
  icon: ComponentType<{ className?: string }>;
  toneClass: string;
  isPrimary?: boolean;
};

type MonitorStatCardProps = {
  label: string;
  value: string;
  hint: string;
  toneClass: string;
  icon: ComponentType<{ className?: string }>;
};

function MonitorStatCard({ label, value, hint, toneClass, icon: Icon }: MonitorStatCardProps) {
  return (
    <Card className={`border shadow-sm ${toneClass}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground" style={{ fontWeight: 600 }}>{label}</p>
            <p className="mt-1 text-[22px] text-zinc-950" style={{ fontWeight: 800, letterSpacing: '-0.03em' }}>{value}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/60 bg-white/90">
            <Icon className="h-5 w-5 text-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MonitorLinkCard({ title, description, href, badge, icon: Icon, toneClass, isPrimary = false }: MonitorLinkCardProps) {
  const navigate = useNavigate();

  return (
    <Card className={`border shadow-sm ${toneClass}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/70 bg-white/90">
                <Icon className="h-4 w-4 text-slate-700" />
              </div>
              <div>
                <p className={isPrimary ? 'text-[15px]' : 'text-[13px]'} style={{ fontWeight: 800 }}>{title}</p>
                <Badge className="mt-1 border border-slate-200 bg-white text-[10px] text-slate-700">{badge}</Badge>
              </div>
            </div>
            <p className="max-w-[32rem] text-[12px] text-slate-700">{description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 border-slate-200 bg-white text-[11px] text-zinc-900 hover:bg-slate-50"
            onClick={() => navigate(href)}
          >
            열기
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CashflowMonitorPage() {
  const { projects } = useAppStore();
  const { weeks, yearMonth, isLoading } = useCashflowWeeks();

  const currentMonthWeeks = useMemo(
    () => weeks.filter((week) => week.yearMonth === yearMonth),
    [weeks, yearMonth],
  );
  const activeProjectCount = useMemo(
    () => new Set(currentMonthWeeks.map((week) => week.projectId)).size,
    [currentMonthWeeks],
  );
  const historicalSubmittedCount = useMemo(
    () => currentMonthWeeks.filter((week) => week.pmSubmitted).length,
    [currentMonthWeeks],
  );
  const historicalClosedCount = useMemo(
    () => currentMonthWeeks.filter((week) => week.adminClosed).length,
    [currentMonthWeeks],
  );
  const primaryLinks = useMemo<MonitorLinkCardProps[]>(
    () => [
      {
        title: '주간 입력 이력',
        description: '프로젝트별 주차 입력 이력을 조회합니다. 최종 확정과 수정 잠금은 월 결산에서 처리합니다.',
        href: '/cashflow/weekly',
        badge: '우선 확인',
        icon: Activity,
        toneClass: 'border-slate-300 bg-white',
        isPrimary: true,
      },
      {
        title: '경영기획실 페이지',
        description: `현재 ${yearMonth} 기준 기존 주차 기록을 워크북으로 확인하고 필요한 범위만 내보냅니다.`,
        href: '/cashflow/export',
        badge: '정리/내보내기',
        icon: FileSpreadsheet,
        toneClass: 'border-slate-200 bg-slate-50',
      },
    ],
    [yearMonth],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldAlert}
        iconGradient="linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)"
        title="캐시플로 모니터링 허브"
        description="주차 입력 이력은 조회용으로 확인하고, 최종 확정은 프로젝트별 월 결산에서 처리합니다."
        badge="관리자 모니터링"
      />

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-zinc-950">현재 {yearMonth}</p>
            <p className="text-[11px] text-muted-foreground">상태 확인과 경영기획실 정리 화면만 상단에 둡니다.</p>
          </div>
          <Badge className="border border-slate-200 bg-white text-[10px] text-slate-700">
            조회 전용
          </Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          {primaryLinks.map((card) => (
            <MonitorLinkCard key={card.href} {...card} />
          ))}
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <MonitorStatCard
          label="전체 프로젝트"
          value={`${projects.length}개`}
          hint={`이번 달 활동 ${activeProjectCount}개`}
          toneClass="border-slate-200 bg-white"
          icon={Activity}
        />
        <MonitorStatCard
          label="이번 달 주차 기록"
          value={`${currentMonthWeeks.length}개`}
          hint={`${yearMonth} 기준`}
          toneClass="border-slate-200 bg-white"
          icon={CalendarRange}
        />
        <MonitorStatCard
          label="기존 제출 이력"
          value={`${historicalSubmittedCount}개`}
          hint="조회용 주차 기록"
          toneClass="border-slate-200 bg-white"
          icon={FileSpreadsheet}
        />
        <MonitorStatCard
          label="기존 결산 이력"
          value={`${historicalClosedCount}개`}
          hint="현재 월 결산 권한과 무관"
          toneClass="border-slate-200 bg-white"
          icon={TrendingUp}
        />
      </div>

      {isLoading && (
        <p className="text-[11px] text-muted-foreground">모니터링 상태를 불러오는 중...</p>
      )}
    </div>
  );
}
