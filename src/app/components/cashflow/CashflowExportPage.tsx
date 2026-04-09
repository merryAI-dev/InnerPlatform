import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  BarChart3,
  CalendarRange,
  CheckCircle2,
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { useAppStore } from '../../data/store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { triggerDownload } from '../../platform/csv-utils';
import { loadExcelJs } from '../../platform/lazy-heavy-modules';
import { exportCashflowWorkbookViaBff, isPlatformApiEnabled } from '../../lib/platform-bff-client';
import {
  buildCashflowExportWorkbookSpec,
  expandCashflowYearMonthRange,
  summarizeCashflowYearMonths,
  type CashflowExportProjectInput,
  type CashflowExportWorkbookVariant,
} from '../../platform/cashflow-export';
import { hasPermission } from '../../platform/rbac';
import { BASIS_LABELS, type Basis } from '../../data/types';

function formatDateTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

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
  const navigate = useNavigate();
  const { projects, transactions } = useAppStore();
  const { weeks, yearMonth } = useCashflowWeeks();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [scope, setScope] = useState<'all' | 'single'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [basisFilter, setBasisFilter] = useState<'ALL' | Basis>('ALL');
  const [rangeMode, setRangeMode] = useState<'year' | 'custom'>('year');
  const [selectedYear, setSelectedYear] = useState<string>(yearMonth.slice(0, 4));
  const [startYearMonth, setStartYearMonth] = useState<string>(`${yearMonth.slice(0, 4)}-01`);
  const [endYearMonth, setEndYearMonth] = useState<string>(`${yearMonth.slice(0, 4)}-12`);
  const [multiProjectVariant, setMultiProjectVariant] = useState<'combined' | 'multi-sheet'>('combined');
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

  const scopedProjects = useMemo(() => {
    if (scope === 'single') {
      return sortedProjects.filter((project) => project.id === selectedProjectId);
    }
    return sortedProjects;
  }, [scope, selectedProjectId, sortedProjects]);

  const targetProjects = useMemo(() => {
    return scopedProjects.filter((project) => basisFilter === 'ALL' || project.basis === basisFilter);
  }, [basisFilter, scopedProjects]);

  const targetYearMonths = useMemo(() => new Set(yearMonths), [yearMonths]);

  const projectInputs = useMemo<CashflowExportProjectInput[]>(() => {
    return targetProjects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      projectShortName: project.shortName,
      weeks: weeks.filter((week) => week.projectId === project.id && targetYearMonths.has(week.yearMonth)),
      transactions: transactions.filter((tx) => tx.projectId === project.id && targetYearMonths.has(tx.dateTime.slice(0, 7))),
    }));
  }, [targetProjects, targetYearMonths, transactions, weeks]);

  const projectRows = useMemo(() => {
    return targetProjects.map((project) => {
      const projectWeeks = weeks.filter((week) => week.projectId === project.id && targetYearMonths.has(week.yearMonth));
      const latestUpdatedAt = projectWeeks.reduce<string | undefined>((latest, week) => {
        if (!week.updatedAt) return latest;
        if (!latest || week.updatedAt > latest) return week.updatedAt;
        return latest;
      }, undefined);
      return {
        id: project.id,
        name: project.name,
        managerName: project.managerName,
        updated: projectWeeks.length > 0,
        latestUpdatedAt,
        weekCount: projectWeeks.length,
      };
    });
  }, [targetProjects, targetYearMonths, weeks]);

  const updatedCount = projectRows.filter((row) => row.updated).length;
  const missingCount = projectRows.length - updatedCount;
  const workbookVariant: CashflowExportWorkbookVariant = scope === 'single' ? 'single-project' : multiProjectVariant;
  const periodSummary = summarizeCashflowYearMonths(yearMonths);
  const basisFilterLabel = basisFilter === 'ALL' ? '전체 기준' : BASIS_LABELS[basisFilter];
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
      toast.error('캐시플로 추출 권한이 없습니다.');
      return;
    }
    if (projectInputs.length === 0 || yearMonths.length === 0) {
      toast.error('다운로드할 사업 또는 기간을 먼저 선택해 주세요.');
      return;
    }

    setDownloadPreparing(true);
    try {
      if (bffEnabled && user) {
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
            projectId: scope === 'single' ? projectInputs[0]?.projectId : undefined,
            basis: basisFilter === 'ALL' ? undefined : basisFilter,
            startYearMonth: yearMonths[0],
            endYearMonth: yearMonths[yearMonths.length - 1],
            variant: workbookVariant,
          },
        });
        triggerDownload(response.blob, response.fileName);
      } else {
        const workbookSpec = buildCashflowExportWorkbookSpec({
          variant: workbookVariant,
          projects: projectInputs,
          yearMonths,
        });
        const ExcelJS = await loadExcelJs();
        const workbook = new ExcelJS.Workbook();

        for (const sheet of workbookSpec.sheets) {
          const worksheet = workbook.addWorksheet(sheet.name);
          sheet.rows.forEach((row) => worksheet.addRow(row));
          worksheet.views = [{ state: 'frozen', ySplit: 2 }];
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob(
          [buffer],
          { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        );
        const fileScope = scope === 'single'
          ? sanitizeFilePart(projectInputs[0]?.projectName || '단일사업')
          : (workbookVariant === 'combined' ? '전체사업_통합시트' : '전체사업_개별시트');
        triggerDownload(blob, `캐시플로_추출_${fileScope}_${sanitizeFilePart(periodSummary || selectedYear)}.xlsx`);
      }
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
          <p className="text-[13px] font-semibold text-zinc-950">경영기획실 전용 캐시플로 추출 권한이 없습니다.</p>
          <p className="text-[12px] text-stone-600">이 화면은 관리자와 경영기획실 담당자만 사용할 수 있습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-export-page">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #fafaf9 0%, #f5f5f4 100%)"
        title="경영기획실 전용 캐시플로 추출 화면"
        description="경영기획실 엑셀 후처리를 위한 연간·기간별 캐시플로 추출 화면"
        badge={scope === 'single' ? '사업별' : '전체사업'}
        badgeVariant="outline"
        actions={(
          <Button
            data-testid="cashflow-export-download"
            onClick={handleDownload}
            disabled={downloadPreparing || projectInputs.length === 0 || yearMonths.length === 0}
            className="h-8 gap-1.5 rounded-lg border border-stone-900 bg-stone-900 text-[12px] text-white hover:bg-stone-800"
          >
            {downloadPreparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloadPreparing ? '준비 중' : '엑셀 다운로드'}
          </Button>
        )}
      />

      <Card className="border-stone-200 bg-white shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px] font-semibold text-zinc-950">추출 설정</CardTitle>
          <p className="text-[12px] text-stone-600">
            {scope === 'single' ? '사업별' : '전체 사업'} · {projectSelectionLabel} · {basisFilterLabel} · {periodSummary || '기간 미선택'} · {workbookVariantLabel}
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
            label="정산 기준"
            helper="프로젝트 등록 시 선택한 정산 기준별로 추출 대상을 걸러냅니다."
            value={basisFilterLabel}
            testId="cashflow-export-step-basis"
            toneClass={monochromeSurfaceClass}
          >
            <Select
              value={basisFilter}
              onValueChange={(value) => {
                if (value === 'ALL' || value === '공급가액' || value === '공급대가' || value === 'NONE') {
                  setBasisFilter(value);
                }
              }}
            >
              <SelectTrigger
                data-testid="cashflow-export-basis"
                className={`${strongFieldBaseClass} border-stone-300 hover:border-stone-400 focus-visible:ring-stone-200`}
                style={{ borderWidth: 2 }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체 기준</SelectItem>
                <SelectItem value="공급가액">공급가액</SelectItem>
                <SelectItem value="공급대가">공급대가</SelectItem>
                <SelectItem value="NONE">해당없음</SelectItem>
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
                  setMultiProjectVariant(value);
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

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-stone-200 bg-stone-50 shadow-none">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white">
                <Layers3 className="h-4 w-4 text-stone-600" />
              </div>
              <p className="text-[11px] text-stone-600">대상 사업</p>
            </div>
            <p className="text-[22px] font-semibold text-zinc-950">{projectRows.length}</p>
            <p className="text-[11px] text-stone-600">{scope === 'single' ? '선택한 사업 1건 기준' : '전체 사업 기준'}</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-stone-50 shadow-none">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white">
                <CheckCircle2 className="h-4 w-4 text-stone-600" />
              </div>
              <p className="text-[11px] text-stone-600">업데이트된 사업</p>
            </div>
            <p className="text-[22px] font-semibold text-zinc-950">{updatedCount}</p>
            <p className="text-[11px] text-stone-600">선택 기간 내 캐시플로 시트 존재</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200 bg-stone-50 shadow-none">
          <CardContent className="p-4 space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white">
                <CalendarRange className="h-4 w-4 text-stone-600" />
              </div>
              <p className="text-[11px] text-stone-600">미업데이트 사업</p>
            </div>
            <p className="text-[22px] font-semibold text-zinc-950">{missingCount}</p>
            <p className="text-[11px] text-stone-600">{periodSummary || '기간을 선택해 주세요'}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 bg-white shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-[14px] font-semibold text-zinc-950">추출 대상 사업</CardTitle>
              <p className="mt-1 text-[12px] text-stone-600">
                {periodSummary || '기간 미선택'} · 월당 5주 고정 슬롯으로 다운로드됩니다.
              </p>
            </div>
            <Badge variant="outline" className="rounded-md border-stone-200 bg-stone-100 text-[11px] text-stone-700">
              {scope === 'single' ? '사업별' : workbookVariant === 'combined' ? '통합 시트' : '개별 시트'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px] font-medium text-stone-500">사업명</TableHead>
                <TableHead className="text-[11px] font-medium text-stone-500">담당자</TableHead>
                <TableHead className="text-[11px] font-medium text-stone-500">상태</TableHead>
                <TableHead className="text-[11px] font-medium text-stone-500">주차 문서 수</TableHead>
                <TableHead className="text-[11px] font-medium text-stone-500">최근 업데이트</TableHead>
                <TableHead className="text-right text-[11px] font-medium text-stone-500">이동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectRows.map((row) => (
                <TableRow key={row.id} data-testid={`cashflow-export-row-${row.id}`}>
                  <TableCell className="font-medium text-zinc-950">{row.name}</TableCell>
                  <TableCell className="text-stone-600">{row.managerName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={row.updated ? 'rounded-md border-stone-300 bg-stone-200 text-stone-800' : 'rounded-md border-stone-200 bg-white text-stone-600'}
                    >
                      {row.updated ? '업데이트됨' : '미업데이트'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-zinc-950">{row.weekCount}</TableCell>
                  <TableCell className="text-stone-600">{formatDateTime(row.latestUpdatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 rounded-lg border border-stone-200 bg-white text-[11px] text-zinc-900 hover:bg-stone-50"
                      onClick={() => navigate(`/cashflow/projects/${row.id}`)}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      사업 보기
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {projectRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-[12px] text-muted-foreground py-8">
                    선택한 조건에 맞는 사업이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-stone-50 shadow-none">
        <CardContent className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[12px] font-semibold text-zinc-950">기존 사업별 주간 시트도 유지됩니다.</p>
            <p className="text-[12px] text-stone-600">
              사업 상세에서는 월 단위 입력과 검토를 계속하고, 이 화면에서는 경영기획실 전용 일괄 추출만 처리합니다.
            </p>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg border-stone-200 bg-white text-[12px] text-zinc-900 hover:bg-stone-100" onClick={() => navigate('/projects')}>
            프로젝트로 이동
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
