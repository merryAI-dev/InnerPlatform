import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarRange,
  Download,
  FileSpreadsheet,
  FolderSearch,
  Layers3,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../layout/PageHeader';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { triggerDownload } from '../../platform/csv-utils';
import { filterCashflowExportTargetProjects } from '../../platform/cashflow-export-filters';
import { exportCashflowWorkbookViaBff, isPlatformApiEnabled } from '../../lib/platform-bff-client';
import {
  expandCashflowYearMonthRange,
  summarizeCashflowYearMonths,
  type CashflowExportWorkbookVariant,
} from '../../platform/cashflow-export';
import { hasPermission } from '../../platform/rbac';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../../data/types';

const strongFieldBaseClass = 'h-10 rounded-lg border-2 bg-white text-[12px] font-medium text-zinc-950 shadow-none transition-colors focus-visible:ring-2 [&_svg]:size-4 [&_svg]:!opacity-100 [&_svg]:text-stone-500';
const activeDisabledFieldClass = 'border-stone-200 bg-stone-100 text-stone-500 shadow-none [&_svg]:text-stone-400';
const monochromeSurfaceClass = 'border-stone-200 bg-stone-50';

function SelectionField(props: {
  step: string;
  icon: typeof BarChart3;
  label: string;
  helper: string;
  value: string;
  testId: string;
  toneClass: string;
  children: ReactNode;
}) {
  const { icon: Icon, label, testId, toneClass, children } = props;
  return (
    <div data-testid={testId} className={`space-y-2 rounded-xl border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-stone-200 bg-white">
          <Icon className="h-3.5 w-3.5 text-stone-600" />
        </div>
        <Label className="text-[11px] font-medium tracking-[0.01em] text-stone-700">{label}</Label>
      </div>
      {children}
    </div>
  );
}

export function CashflowExportPage() {
  const { projects } = useAppStore();
  const { yearMonth } = useCashflowWeeks();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [scope, setScope] = useState<'all' | 'single'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [accountTypeFilter, setAccountTypeFilter] = useState<'ALL' | AccountType>('ALL');
  const [rangeMode, setRangeMode] = useState<'year' | 'custom'>('year');
  const [selectedYear, setSelectedYear] = useState<string>(yearMonth.slice(0, 4));
  const [startYearMonth, setStartYearMonth] = useState<string>(`${yearMonth.slice(0, 4)}-01`);
  const [endYearMonth, setEndYearMonth] = useState<string>(`${yearMonth.slice(0, 4)}-12`);
  const [multiProjectVariant, setMultiProjectVariant] = useState<'combined' | 'multi-sheet'>('multi-sheet');
  const [downloadPreparing, setDownloadPreparing] = useState(false);

  const canExport = hasPermission((user?.role || 'viewer') as any, 'cashflow:export');
  const bffEnabled = isPlatformApiEnabled();

  const sortedProjects = useMemo(
    () => [...projects].sort((left, right) => left.name.localeCompare(right.name, 'ko')),
    [projects],
  );

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const project of sortedProjects) {
      if (/^\d{4}/.test(project.contractStart)) years.add(project.contractStart.slice(0, 4));
      if (/^\d{4}/.test(project.contractEnd)) years.add(project.contractEnd.slice(0, 4));
    }
    years.add(yearMonth.slice(0, 4));
    return Array.from(years).sort();
  }, [sortedProjects, yearMonth]);

  const yearMonths = useMemo(() => {
    if (rangeMode === 'year') {
      return expandCashflowYearMonthRange(`${selectedYear}-01`, `${selectedYear}-12`);
    }
    return expandCashflowYearMonthRange(startYearMonth, endYearMonth);
  }, [endYearMonth, rangeMode, selectedYear, startYearMonth]);

  const targetProjects = useMemo(() => {
    return filterCashflowExportTargetProjects(sortedProjects, {
      scope,
      selectedProjectId,
      accountTypeFilter,
    });
  }, [accountTypeFilter, scope, selectedProjectId, sortedProjects]);

  const workbookVariant: CashflowExportWorkbookVariant = scope === 'single' ? 'single-project' : multiProjectVariant;
  const periodSummary = summarizeCashflowYearMonths(yearMonths);
  const accountTypeFilterLabel = accountTypeFilter === 'ALL' ? '전체 통장 유형' : ACCOUNT_TYPE_LABELS[accountTypeFilter];
  const projectSelectionLabel = scope === 'single'
    ? (sortedProjects.find((project) => project.id === selectedProjectId)?.name || '사업을 선택해 주세요')
    : '전체 사업';
  const workbookVariantLabel = scope === 'single'
    ? '사업별 단일 워크북'
    : workbookVariant === 'combined'
      ? '전체 사업 통합 시트'
      : '전체 사업 개별 시트';
  useEffect(() => {
    if (scope !== 'single') return;
    const selectedExists = sortedProjects.some((project) => project.id === selectedProjectId);
    if (!selectedExists && sortedProjects[0]?.id) {
      setSelectedProjectId(sortedProjects[0].id);
    }
  }, [scope, selectedProjectId, sortedProjects]);

  async function handleDownload() {
    if (!canExport) {
      toast.error('경영기획실 페이지 접근 권한이 없습니다.');
      return;
    }
    if (!bffEnabled || !user) {
      toast.error('내보내기 서버에 연결되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    if (targetProjects.length === 0 || yearMonths.length === 0) {
      toast.error('다운로드할 사업 또는 기간을 먼저 선택해 주세요.');
      return;
    }

    setDownloadPreparing(true);
    try {
      const response = await exportCashflowWorkbookViaBff({
          tenantId: orgId,
          actor: {
            uid: user.uid,
            email: user.email,
            role: user.role,
            idToken: user.idToken,
            googleAccessToken: user.googleAccessToken,
          },
          body: {
            scope,
            projectId: scope === 'single' ? targetProjects[0]?.id : undefined,
            accountType: accountTypeFilter === 'ALL' ? undefined : accountTypeFilter,
            startYearMonth: yearMonths[0],
            endYearMonth: yearMonths[yearMonths.length - 1],
            variant: workbookVariant,
          },
      });
      triggerDownload(response.blob, response.fileName);
      toast.success('캐시플로 엑셀을 준비했습니다.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '캐시플로 다운로드에 실패했습니다.';
      toast.error(message);
    } finally {
      setDownloadPreparing(false);
    }
  }

  if (!canExport) {
    return (
        <Card>
        <CardContent className="p-8 text-center space-y-2">
          <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <p className="text-[13px] font-semibold text-zinc-950">경영기획실 페이지 접근 권한이 없습니다.</p>
          <p className="text-[12px] text-stone-600">관리자와 경영기획실 담당자만 주간 상태 정리와 엑셀 다운로드를 사용할 수 있습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-export-page">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #fafaf9 0%, #f5f5f4 100%)"
        title="현금흐름 내보내기"
        description="프로젝트와 기간을 선택해 서버 기준 현금흐름 엑셀을 다운로드합니다."
        badge={scope === 'single' ? '사업별 추출' : '전체 추출'}
        badgeVariant="outline"
        actions={(
          <Button
            data-testid="cashflow-export-download"
            onClick={handleDownload}
            disabled={downloadPreparing || !bffEnabled || targetProjects.length === 0 || yearMonths.length === 0}
            className="h-8 gap-1.5 rounded-lg border border-stone-900 bg-stone-900 text-[12px] text-white hover:bg-stone-800"
          >
            {downloadPreparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloadPreparing ? '준비 중' : '엑셀 다운로드'}
          </Button>
        )}
      />

      <Card className="border-stone-200 bg-white shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold text-zinc-950">내보내기 설정</CardTitle>
          <p className="text-[12px] text-stone-600">
            {scope === 'single' ? '사업별' : '전체 사업'} · {projectSelectionLabel} · {accountTypeFilterLabel} · {periodSummary || '기간 미선택'} · {workbookVariantLabel}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectionField
            step="1"
            icon={Layers3}
            label="대상 범위"
            helper="전체 사업 일괄 추출인지, 특정 사업 단건 추출인지 먼저 고릅니다."
            value={scope === 'single' ? '사업별 추출' : '전체 사업'}
            testId="cashflow-export-step-range"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === 'all' || value === 'single') setScope(value);
              }}
            >
              <SelectTrigger
                data-testid="cashflow-export-scope"
                className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 사업</SelectItem>
                <SelectItem value="single">사업별 추출</SelectItem>
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="2"
            icon={FolderSearch}
            label="사업 선택"
            helper={scope === 'single' ? '단일 사업 워크북으로 내릴 대상을 고릅니다.' : '전체 사업 범위에서는 자동으로 모든 사업이 포함됩니다.'}
            value={scope === 'single' ? projectSelectionLabel : '자동 포함'}
            testId="cashflow-export-step-project"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={scope === 'single' ? selectedProjectId : 'ALL'}
              onValueChange={setSelectedProjectId}
              disabled={scope !== 'single'}
            >
              <SelectTrigger
                data-testid="cashflow-export-project"
                className={`${strongFieldBaseClass} ${
                  scope === 'single'
                    ? 'border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200'
                    : activeDisabledFieldClass
                }`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue placeholder="사업을 선택해 주세요" />
              </SelectTrigger>
              <SelectContent>
                {scope !== 'single' && <SelectItem value="ALL">전체 사업</SelectItem>}
                {sortedProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="2B"
            icon={BarChart3}
            label="통장 유형"
            helper="프로젝트 등록 시 선택한 통장 유형별로 추출 대상을 걸러냅니다."
            value={accountTypeFilterLabel}
            testId="cashflow-export-step-account-type"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={accountTypeFilter}
              onValueChange={(value) => {
                if (value === 'ALL' || value === 'DEDICATED' || value === 'OPERATING' || value === 'NONE') {
                  setAccountTypeFilter(value as 'ALL' | AccountType);
                }
              }}
            >
              <SelectTrigger
                data-testid="cashflow-export-account-type"
                className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 통장 유형</SelectItem>
                {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="3"
            icon={CalendarRange}
            label="기간 범위"
            helper="기본은 연간 일괄이며, 필요하면 시작 월과 종료 월을 직접 지정할 수 있습니다."
            value={rangeMode === 'year' ? '연간 일괄' : '기간 직접 선택'}
            testId="cashflow-export-step-period"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={rangeMode}
              onValueChange={(value) => {
                if (value === 'year' || value === 'custom') setRangeMode(value);
              }}
            >
              <SelectTrigger
                data-testid="cashflow-export-range-mode"
                className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year">연간 일괄</SelectItem>
                <SelectItem value="custom">기간 직접 선택</SelectItem>
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="4"
            icon={FileSpreadsheet}
            label="워크북 형식"
            helper="경영기획실 후처리 방식에 맞춰 통합 시트 또는 사업별 시트를 선택합니다."
            value={workbookVariantLabel}
            testId="cashflow-export-step-variant"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={workbookVariant}
              onValueChange={(value) => {
                if (value === 'single-project') {
                  setScope('single');
                  return;
                }
                if (value === 'combined' || value === 'multi-sheet') {
                  setScope('all');
                  setMultiProjectVariant(value as 'combined' | 'multi-sheet');
                }
              }}
            >
              <SelectTrigger
                data-testid="cashflow-export-variant"
                className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single-project">사업별 단일 워크북</SelectItem>
                <SelectItem value="combined">전체 사업 통합 시트</SelectItem>
                <SelectItem value="multi-sheet">전체 사업 개별 시트</SelectItem>
              </SelectContent>
            </Select>
          </SelectionField>

          {rangeMode === 'year' ? (
            <SelectionField
              step="3A"
              icon={CalendarRange}
              label="추출 연도"
              helper="월당 5주 고정 슬롯으로 1년 전체를 한 번에 구성합니다."
              value={`${selectedYear}년`}
              testId="cashflow-export-step-year"
              toneClass={`${monochromeSurfaceClass} md:col-span-2`}
            >
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger
                  id="cashflow-export-year"
                  data-testid="cashflow-export-year"
                  className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                  style={{ borderWidth: 2 }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>{year}년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SelectionField>
          ) : (
            <>
              <SelectionField
                step="3A"
                icon={CalendarRange}
                label="시작 월"
                helper="직접 추출을 시작할 월입니다."
                value={startYearMonth || '미선택'}
                testId="cashflow-export-step-start"
                toneClass={monochromeSurfaceClass}
              >
                <Input
                  id="cashflow-export-start"
                  data-testid="cashflow-export-start"
                  type="month"
                  value={startYearMonth}
                  onChange={(event) => setStartYearMonth(event.target.value)}
                  className="h-10 rounded-lg border-2 border-stone-300 bg-white text-[12px] font-medium text-zinc-950 shadow-none focus-visible:ring-2 focus-visible:ring-stone-200"
                />
              </SelectionField>
              <SelectionField
                step="3B"
                icon={CalendarRange}
                label="종료 월"
                helper="마지막으로 포함할 월입니다."
                value={endYearMonth || '미선택'}
                testId="cashflow-export-step-end"
                toneClass={monochromeSurfaceClass}
              >
                <Input
                  id="cashflow-export-end"
                  data-testid="cashflow-export-end"
                  type="month"
                  value={endYearMonth}
                  onChange={(event) => setEndYearMonth(event.target.value)}
                  className="h-10 rounded-lg border-2 border-stone-300 bg-white text-[12px] font-medium text-zinc-950 shadow-none focus-visible:ring-2 focus-visible:ring-stone-200"
                />
              </SelectionField>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-stone-50 shadow-none">
        <CardContent className="grid gap-3 p-4 text-[12px] text-stone-600 sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-stone-500">대상 사업</p>
            <p className="mt-1 font-semibold text-zinc-950">{targetProjects.length}건</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500">기간</p>
            <p className="mt-1 font-semibold text-zinc-950">{periodSummary || '기간 미선택'}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500">생성 기준</p>
            <p className="mt-1 font-semibold text-zinc-950">BFF 서버의 최신 현금흐름 데이터</p>
          </div>
          {!bffEnabled ? <p className="sm:col-span-3 text-red-700">내보내기 서버 연결을 확인해 주세요.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
