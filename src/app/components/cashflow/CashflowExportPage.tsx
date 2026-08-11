import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart3,
  CalendarRange,
  Check,
  ChevronsUpDown,
  Download,
  ExternalLink,
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
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { triggerDownload } from '../../platform/csv-utils';
import { filterCashflowExportTargetProjects } from '../../platform/cashflow-export-filters';
import { buildCashflowExportProjectRows } from '../../platform/cashflow-export-surface';
import { exportCashflowWorkbookViaBff, isPlatformApiEnabled } from '../../lib/platform-bff-client';
import {
  expandCashflowYearMonthRange,
  summarizeCashflowYearMonths,
  type CashflowExportWorkbookVariant,
} from '../../platform/cashflow-export';
import { hasPermission } from '../../platform/rbac';
import { getSeoulTodayIso } from '../../platform/business-days';
import { ACCOUNT_TYPE_LABELS, type AccountType } from '../../data/types';
import { CashflowCanonicalSummary } from './CashflowCanonicalSummary';
import { useCashflowProjectionActualSummaries } from './useCashflowProjectionActualSummaries';

const strongFieldBaseClass = 'h-10 rounded-lg border-2 bg-white text-[12px] font-medium text-zinc-950 shadow-none transition-colors focus-visible:ring-2 [&_svg]:size-4 [&_svg]:!opacity-100 [&_svg]:text-stone-500';
const activeDisabledFieldClass = 'border-stone-200 bg-stone-100 text-stone-500 shadow-none [&_svg]:text-stone-400';
const monochromeSurfaceClass = 'border-stone-200 bg-stone-50';

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function formatDifference(value?: number): string {
  if (typeof value !== 'number') return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

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
  const navigate = useNavigate();
  const { projects } = useAppStore();
  const { yearMonth, weeks, isLoading: weeksLoading, loadError: weeksLoadError } = useCashflowWeeks();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
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

  const departments = useMemo(() => Array.from(new Set(
    sortedProjects.map((project) => project.department).filter(Boolean),
  )).sort((left, right) => left.localeCompare(right, 'ko')), [sortedProjects]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const project of sortedProjects) {
      if (/^\d{4}/.test(project.contractStart)) years.add(project.contractStart.slice(0, 4));
      if (/^\d{4}/.test(project.contractEnd)) years.add(project.contractEnd.slice(0, 4));
    }
    years.add('2024');
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
      selectedProjectIds,
      departmentFilter,
      accountTypeFilter,
    });
  }, [accountTypeFilter, departmentFilter, scope, selectedProjectIds, sortedProjects]);
  const targetProjectIds = useMemo(() => targetProjects.map((project) => project.id), [targetProjects]);
  const canonicalSummaries = useCashflowProjectionActualSummaries({ tenantId: orgId, actor: user, projectIds: targetProjectIds });

  const workbookVariant: CashflowExportWorkbookVariant = multiProjectVariant;
  const periodSummary = summarizeCashflowYearMonths(yearMonths);
  const accountTypeFilterLabel = accountTypeFilter === 'ALL' ? '전체 통장 유형' : ACCOUNT_TYPE_LABELS[accountTypeFilter];
  const projectSelectionLabel = scope === 'selected'
    ? `${targetProjects.length}개 사업 선택`
    : '전체 사업';
  const workbookVariantLabel = workbookVariant === 'combined' ? '대상 사업 통합 시트' : '대상 사업 개별 시트';
  const exportRows = useMemo(() => buildCashflowExportProjectRows({
    projects: targetProjects,
    weeks,
    targetYearMonths: yearMonths,
    todayIso: getSeoulTodayIso(),
  }), [targetProjects, weeks, yearMonths]);

  function toggleProject(projectId: string) {
    setSelectedProjectIds((current) => current.includes(projectId)
      ? current.filter((id) => id !== projectId)
      : [...current, projectId]);
  }

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
            scope: 'all',
            projectIds: scope === 'selected' || departmentFilter !== 'ALL'
              ? targetProjects.map((project) => project.id)
              : undefined,
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
        title="경영기획실 통합 관리"
        description="프로젝트와 기간을 선택해 서버 기준 현금흐름 엑셀을 다운로드합니다."
        badge={scope === 'selected' ? '선택 사업 추출' : '전체 추출'}
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
            {scope === 'selected' ? '선택 사업' : '전체 사업'} · {projectSelectionLabel} · {accountTypeFilterLabel} · {periodSummary || '기간 미선택'} · {workbookVariantLabel}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SelectionField
            step="1"
            icon={Layers3}
            label="대상 범위"
            helper="전체 사업을 한 번에 받을지, 필요한 사업을 여러 개 고를지 선택합니다."
            value={scope === 'selected' ? '사업 선택' : '전체 사업'}
            testId="cashflow-export-step-range"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === 'all' || value === 'selected') setScope(value);
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
                <SelectItem value="selected">사업 선택</SelectItem>
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="2"
            icon={Layers3}
            label="소속(CIC/센터)"
            helper="담당 조직을 기준으로 다운로드 대상을 좁힙니다."
            value={departmentFilter === 'ALL' ? '전체 소속' : departmentFilter}
            testId="cashflow-export-step-department"
            toneClass={monochromeSurfaceClass}
          >
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger data-testid="cashflow-export-department" className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`} style={{ borderWidth: 2 }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 소속</SelectItem>
                {departments.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}
              </SelectContent>
            </Select>
          </SelectionField>

          <SelectionField
            step="3"
            icon={FolderSearch}
            label="사업 다중선택"
            helper={scope === 'selected' ? '다운로드할 사업을 여러 개 선택합니다.' : '전체 사업 범위에서는 자동으로 모든 사업이 포함됩니다.'}
            value={scope === 'selected' ? projectSelectionLabel : '자동 포함'}
            testId="cashflow-export-step-project"
            toneClass={monochromeSurfaceClass}
          >
            <Popover open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  data-testid="cashflow-export-project"
                  disabled={scope !== 'selected'}
                  className={`${strongFieldBaseClass} w-full justify-between px-3 ${scope === 'selected' ? 'border-stone-300' : activeDisabledFieldClass}`}
                >
                  <span className="truncate">{scope === 'selected' ? projectSelectionLabel : '전체 사업 자동 포함'}</span>
                  <ChevronsUpDown className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command>
                  <CommandInput placeholder="사업명 또는 소속 검색" />
                  <CommandList className="max-h-[300px]">
                    <CommandEmpty>조건에 맞는 사업이 없습니다.</CommandEmpty>
                    <CommandGroup heading="다운로드할 사업">
                      {sortedProjects
                        .filter((project) => departmentFilter === 'ALL' || project.department === departmentFilter)
                        .filter((project) => accountTypeFilter === 'ALL' || project.accountType === accountTypeFilter)
                        .map((project) => {
                          const selected = selectedProjectIds.includes(project.id);
                          return (
                            <CommandItem key={project.id} value={`${project.name} ${project.department}`} onSelect={() => toggleProject(project.id)}>
                              <Check className={`h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`} />
                              <span className="truncate">{project.name}</span>
                              <span className="ml-auto text-[10px] text-muted-foreground">{project.department}</span>
                            </CommandItem>
                          );
                        })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </SelectionField>

          <SelectionField
            step="4"
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
            step="5"
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
            step="6"
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
                if (value === 'combined' || value === 'multi-sheet') {
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
                <SelectItem value="combined">대상 사업 통합 시트</SelectItem>
                <SelectItem value="multi-sheet">대상 사업 개별 시트</SelectItem>
              </SelectContent>
            </Select>
          </SelectionField>

          {rangeMode === 'year' ? (
            <SelectionField
              step="7"
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
                step="7A"
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
                step="7B"
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

      <Card className="border-stone-200 bg-white shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold text-zinc-950">다운로드 대상 사업</CardTitle>
          <p className="text-[11px] text-stone-600">
            상태는 지난 목요일 자정 이후 해당 사업의 현금흐름이 한 번이라도 수정되었는지 보여줍니다.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[900px] text-[11px]">
              <thead className="sticky top-0 z-10 bg-stone-50">
                <tr className="border-y border-stone-200">
                  <th className="px-4 py-2 text-left font-semibold">사업명</th>
                  <th className="px-3 py-2 text-left font-semibold">담당자</th>
                  <th className="px-3 py-2 text-center font-semibold">상태</th>
                  <th className="px-3 py-2 text-center font-semibold">누적 Projection-Actual / 현재 주차 상세</th>
                  <th className="px-3 py-2 text-left font-semibold">최근 업데이트</th>
                  <th className="px-4 py-2 text-right font-semibold">이동</th>
                </tr>
              </thead>
              <tbody>
                {weeksLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-stone-500">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> 현금흐름 상태를 불러오는 중입니다.
                    </td>
                  </tr>
                ) : weeksLoadError ? (
                  <tr>
                    <td colSpan={6} className="bg-red-50 px-4 py-10 text-center font-medium text-red-700">{weeksLoadError}</td>
                  </tr>
                ) : exportRows.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 hover:bg-stone-50/70">
                    <td className="px-4 py-3 font-semibold text-zinc-950">{row.name}</td>
                    <td className="px-3 py-3 text-stone-700">{row.managerName || '-'}</td>
                    <td className="px-3 py-3 text-center">
                      <Badge variant="outline" className={row.updated ? 'border-teal-200 bg-teal-50 text-teal-700' : 'border-stone-200 bg-stone-50 text-stone-600'}>
                        {row.updated ? '업데이트됨' : '미업데이트'}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <CashflowCanonicalSummary
                        summary={canonicalSummaries.summaries[row.id]}
                        loading={canonicalSummaries.loading[row.id]}
                        error={canonicalSummaries.errors[row.id]}
                        onRetry={() => void canonicalSummaries.retry(row.id)}
                      />
                      <div className="mt-2 border-t border-stone-200 pt-2 text-[10px] text-stone-500">현재 주차 상세</div>
                      {typeof row.projectionActualMatches !== 'boolean' ? (
                        <span className="text-stone-500">
                          {row.currentWeekLabel} · {row.comparisonMissing === 'actual' ? 'Actual 미작성' : 'Projection 미작성'}
                        </span>
                      ) : (
                        <div>
                          <span className={row.projectionActualMatches ? 'font-semibold text-teal-700' : 'font-semibold text-red-700'}>
                            {row.currentWeekLabel} · {row.projectionActualMatches ? '일치' : '불일치'}
                          </span>
                          <div className="mt-0.5 tabular-nums text-stone-500">
                            입금 {formatDifference(row.projectionActualInDifference)} · 출금 {formatDifference(row.projectionActualOutDifference)} · 순액 {formatDifference(row.projectionActualDifference)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-stone-600">{formatDateTime(row.latestUpdatedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => navigate(`/cashflow/projects/${row.id}?ym=${encodeURIComponent(yearMonth)}&view=compare#projection-actual-comparison`)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" /> 사업 보기
                      </Button>
                    </td>
                  </tr>
                ))}
                {!weeksLoading && !weeksLoadError && exportRows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-500">조건에 맞는 사업이 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
