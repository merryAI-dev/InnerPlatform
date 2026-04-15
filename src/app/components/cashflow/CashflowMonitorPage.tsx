import { useMemo, type ComponentType } from 'react';
import { useNavigate } from 'react-router';
import {
  Activity,
  ArrowRight,
  ArrowLeftRight,
  BarChart3,
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
    <Card className={`shadow-sm ${toneClass}`}>
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

function MonitorLinkCard({ title, description, href, badge, icon: Icon, toneClass }: MonitorLinkCardProps) {
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
                <p className="text-[13px]" style={{ fontWeight: 800, letterSpacing: '-0.01em' }}>{title}</p>
                <Badge className="mt-1 border border-white/70 bg-white/80 text-[10px] text-slate-700">{badge}</Badge>
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
  const navigate = useNavigate();
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
  const unsubmittedCount = useMemo(
    () => currentMonthWeeks.filter((week) => !week.pmSubmitted).length,
    [currentMonthWeeks],
  );
  const pendingCloseCount = useMemo(
    () => currentMonthWeeks.filter((week) => week.pmSubmitted && !week.adminClosed).length,
    [currentMonthWeeks],
  );
  const closedCount = useMemo(
    () => currentMonthWeeks.filter((week) => week.adminClosed).length,
    [currentMonthWeeks],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldAlert}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
        title="캐시플로 모니터링 허브"
        description="먼저 상태를 보고, 필요할 때만 내보내기 도구로 이동합니다."
        badge="관리자 모니터링"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <MonitorStatCard
          label="전체 프로젝트"
          value={`${projects.length}개`}
          hint={`이번 달 활동 ${activeProjectCount}개`}
          toneClass="border-slate-200 bg-white"
          icon={Activity}
        />
        <MonitorStatCard
          label="이번 달 주차"
          value={`${currentMonthWeeks.length}개`}
          hint={`${yearMonth} 기준`}
          toneClass="border-teal-200 bg-teal-50/70"
          icon={CalendarRange}
        />
        <MonitorStatCard
          label="작성 대기"
          value={`${unsubmittedCount}개`}
          hint="PM 미작성 주차"
          toneClass="border-amber-200 bg-amber-50/70"
          icon={FileSpreadsheet}
        />
        <MonitorStatCard
          label="결산 완료"
          value={`${closedCount}개`}
          hint={`결산 대기 ${pendingCloseCount}개`}
          toneClass="border-indigo-200 bg-indigo-50/70"
          icon={TrendingUp}
        />
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-zinc-950">실시간 모니터링</p>
            <p className="text-[11px] text-muted-foreground">주간 상태와 대조를 먼저 확인합니다.</p>
          </div>
          <Badge className="border border-teal-200 bg-teal-50 text-[10px] text-teal-700">
            현재 {yearMonth}
          </Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <MonitorLinkCard
            title="주간 모니터링"
            description="프로젝트별 주차 상태, 편차, 결산 흐름을 확인합니다."
            href="/cashflow/weekly"
            badge="운영"
            icon={Activity}
            toneClass="border-teal-200 bg-teal-50/80"
          />
          <MonitorLinkCard
            title="분석 대시보드"
            description="입출금 추이와 항목별 분포를 빠르게 훑어봅니다."
            href="/cashflow/analytics"
            badge="추세"
            icon={BarChart3}
            toneClass="border-indigo-200 bg-indigo-50/80"
          />
          <MonitorLinkCard
            title="은행 대조"
            description="은행 CSV와 시스템 거래를 맞춰 미매칭을 찾아냅니다."
            href="/bank-reconciliation"
            badge="대조"
            icon={ArrowLeftRight}
            toneClass="border-amber-200 bg-amber-50/80"
          />
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-[12px] font-semibold text-zinc-950">보조 도구</p>
          <p className="text-[11px] text-muted-foreground">모니터링 뒤 필요한 범위만 내보냅니다.</p>
        </div>
        <MonitorLinkCard
          title="엑셀 내보내기"
          description={`현재 ${yearMonth} 기준 상태를 워크북으로 추출합니다. 모니터링 허브에서 분리된 보조 도구입니다.`}
          href="/cashflow/export"
          badge="내보내기"
          icon={FileSpreadsheet}
          toneClass="border-stone-200 bg-stone-50/90"
        />
      </section>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardContent className="flex flex-col gap-3 px-5 py-4 text-[12px] text-slate-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="font-semibold text-slate-950">상태 우선, 추출은 다음 단계</p>
            <p>먼저 주간 상태와 대조 결과를 확인하고, 그 뒤에만 내보내기 화면으로 이동하세요.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5 text-[12px]"
            onClick={() => navigate('/cashflow/export')}
          >
            엑셀 내보내기 열기
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>

      {isLoading && (
        <p className="text-[11px] text-muted-foreground">모니터링 상태를 불러오는 중...</p>
      )}
    </div>
  );
}
