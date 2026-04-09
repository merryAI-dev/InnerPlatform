import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BarChart3, Download, ExternalLink, FileSpreadsheet, Loader2 } from 'lucide-react';
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

export function CashflowExportPage() {
  const navigate = useNavigate();
  const { projects, transactions } = useAppStore();
  const { weeks, yearMonth } = useCashflowWeeks();
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [scope, setScope] = useState<'all' | 'single'>('all');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
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

  const targetProjects = useMemo(() => {
    if (scope === 'single') {
      return sortedProjects.filter((project) => project.id === selectedProjectId);
    }
    return sortedProjects;
  }, [scope, selectedProjectId, sortedProjects]);

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
          <p className="text-[13px]" style={{ fontWeight: 600 }}>캐시플로 추출 권한이 없습니다.</p>
          <p className="text-[12px] text-muted-foreground">이 화면은 관리자와 재경팀만 사용할 수 있습니다.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="cashflow-export-page">
      <PageHeader
        icon={BarChart3}
        iconGradient="linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)"
        title="캐시플로 추출"
        description="재경팀 엑셀 후처리를 위한 연간·기간별 캐시플로 추출 화면"
        badge={scope === 'single' ? '사업별' : '전체사업'}
        actions={(
          <Button
            data-testid="cashflow-export-download"
            onClick={handleDownload}
            disabled={downloadPreparing || projectInputs.length === 0 || yearMonths.length === 0}
            className="gap-1.5 h-8 text-[12px]"
          >
            {downloadPreparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {downloadPreparing ? '준비 중' : '엑셀 다운로드'}
          </Button>
        )}
      />

      <Card className="border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,118,110,0.03),rgba(255,255,255,0))]">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px]">추출 조건</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-[12px]">대상 범위</Label>
            <Select
              value={scope}
              onValueChange={(value) => {
                if (value === 'all' || value === 'single') setScope(value);
              }}
            >
              <SelectTrigger data-testid="cashflow-export-scope" className="h-9 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 사업</SelectItem>
                <SelectItem value="single">사업별 추출</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px]">사업 선택</Label>
            <Select
              value={scope === 'single' ? selectedProjectId : 'ALL'}
              onValueChange={setSelectedProjectId}
              disabled={scope !== 'single'}
            >
              <SelectTrigger data-testid="cashflow-export-project" className="h-9 text-[12px]">
                <SelectValue placeholder="사업을 선택해 주세요" />
              </SelectTrigger>
              <SelectContent>
                {scope !== 'single' && <SelectItem value="ALL">전체 사업</SelectItem>}
                {sortedProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px]">기간 범위</Label>
            <Select
              value={rangeMode}
              onValueChange={(value) => {
                if (value === 'year' || value === 'custom') setRangeMode(value);
              }}
            >
              <SelectTrigger data-testid="cashflow-export-range-mode" className="h-9 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year">연간 일괄</SelectItem>
                <SelectItem value="custom">기간 직접 선택</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-[12px]">워크북 형식</Label>
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
              <SelectTrigger data-testid="cashflow-export-variant" className="h-9 text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single-project">사업별 단일 워크북</SelectItem>
                <SelectItem value="combined">전체 사업 통합 시트</SelectItem>
                <SelectItem value="multi-sheet">전체 사업 개별 시트</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {rangeMode === 'year' ? (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="cashflow-export-year" className="text-[12px]">추출 연도</Label>
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger id="cashflow-export-year" data-testid="cashflow-export-year" className="h-9 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>{year}년</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="cashflow-export-start" className="text-[12px]">시작 월</Label>
                <Input
                  id="cashflow-export-start"
                  data-testid="cashflow-export-start"
                  type="month"
                  value={startYearMonth}
                  onChange={(event) => setStartYearMonth(event.target.value)}
                  className="h-9 text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cashflow-export-end" className="text-[12px]">종료 월</Label>
                <Input
                  id="cashflow-export-end"
                  data-testid="cashflow-export-end"
                  type="month"
                  value={endYearMonth}
                  onChange={(event) => setEndYearMonth(event.target.value)}
                  className="h-9 text-[12px]"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-slate-200/80">
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] text-muted-foreground">대상 사업</p>
            <p className="text-[22px]" style={{ fontWeight: 800 }}>{projectRows.length}</p>
            <p className="text-[11px] text-muted-foreground">{scope === 'single' ? '선택한 사업 1건 기준' : '전체 사업 기준'}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80">
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] text-muted-foreground">업데이트된 사업</p>
            <p className="text-[22px]" style={{ fontWeight: 800 }}>{updatedCount}</p>
            <p className="text-[11px] text-muted-foreground">선택 기간 내 캐시플로 시트 존재</p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80">
          <CardContent className="p-4 space-y-1">
            <p className="text-[11px] text-muted-foreground">미업데이트 사업</p>
            <p className="text-[22px]" style={{ fontWeight: 800 }}>{missingCount}</p>
            <p className="text-[11px] text-muted-foreground">{periodSummary || '기간을 선택해 주세요'}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-[14px]">추출 대상 사업</CardTitle>
              <p className="text-[12px] text-muted-foreground mt-1">
                {periodSummary || '기간 미선택'} · 월당 5주 고정 슬롯으로 다운로드됩니다.
              </p>
            </div>
            <Badge variant="outline" className="text-[11px]">
              {scope === 'single' ? '사업별' : workbookVariant === 'combined' ? '통합 시트' : '개별 시트'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>사업명</TableHead>
                <TableHead>담당자</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>주차 문서 수</TableHead>
                <TableHead>최근 업데이트</TableHead>
                <TableHead className="text-right">이동</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectRows.map((row) => (
                <TableRow key={row.id} data-testid={`cashflow-export-row-${row.id}`}>
                  <TableCell style={{ fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.managerName}</TableCell>
                  <TableCell>
                    <Badge variant={row.updated ? 'default' : 'outline'}>
                      {row.updated ? '업데이트됨' : '미업데이트'}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.weekCount}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDateTime(row.latestUpdatedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 h-8 text-[11px]"
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

      <Card className="border-dashed">
        <CardContent className="p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[12px]" style={{ fontWeight: 600 }}>기존 사업별 주간 시트도 유지됩니다.</p>
            <p className="text-[12px] text-muted-foreground">
              사업 상세에서는 월 단위 입력과 검토를 계속하고, 이 화면에서는 재경팀용 일괄 추출만 처리합니다.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-[12px]" onClick={() => navigate('/projects')}>
            프로젝트로 이동
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
