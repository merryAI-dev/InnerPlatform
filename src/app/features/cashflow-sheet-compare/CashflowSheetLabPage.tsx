import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, FileSpreadsheet, Loader2, Pencil, Search, Settings } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  extractSpreadsheetIdFromSheetInput,
  getCashflowSheetLabConfigViaBff,
  previewCashflowSheetLabViaBff,
  saveCashflowSheetLabConfigViaBff,
  type CashflowSheetLabConfig,
  type CashflowSheetLabPreviewValue,
  type CashflowSheetLabPreviewResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { readRecentPortalProjectIds, rememberRecentPortalProject } from '../../platform/portal-recent-projects';

function formatMode(mode: string) {
  return mode === 'projection' ? 'Projection' : 'Actual';
}

function formatAmount(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function parseSheetAmount(value: string) {
  const normalized = String(value || '').replace(/,/g, '').replace(/\s+/g, '').trim();
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  return '시트 구조를 확인하지 못했습니다.';
}

function formatTimestamp(value: string | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

function weekKey(yearMonth: string, weekNo: number) {
  return `${yearMonth}:W${weekNo}`;
}

function previewValueKey(value: Pick<CashflowSheetLabPreviewValue, 'mode' | 'lineId' | 'yearMonth' | 'weekNo'>) {
  return `${value.mode}:${value.lineId}:${weekKey(value.yearMonth, value.weekNo)}`;
}

function compareWeekLike(
  a: Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>,
  b: Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>,
) {
  return a.yearMonth.localeCompare(b.yearMonth) || a.weekNo - b.weekNo;
}

function formatWeekLabel(yearMonth: string, weekNo: number) {
  return `${yearMonth} W${weekNo}`;
}

function selectPreviewAmount(value: CashflowSheetLabPreviewValue | undefined) {
  if (!value) return { sheetAmount: null, reflectedAmount: null, displayAmount: null, diff: null };
  const sheetAmount = parseSheetAmount(value.sheetValue);
  const reflectedAmount = value.amount;
  const displayAmount = typeof sheetAmount === 'number' ? sheetAmount : reflectedAmount;
  const diff = typeof reflectedAmount === 'number' && typeof sheetAmount === 'number'
    ? reflectedAmount - sheetAmount
    : null;
  return { sheetAmount, reflectedAmount, displayAmount, diff };
}

function buildCashflowPreviewTables(preview: CashflowSheetLabPreviewResult | null) {
  if (!preview) return [];
  const valueIndex = new Map<string, CashflowSheetLabPreviewValue>();
  const weeksByMode = new Map<string, Map<string, Pick<CashflowSheetLabPreviewValue, 'yearMonth' | 'weekNo'>>>();

  for (const value of preview.previewValues) {
    valueIndex.set(previewValueKey(value), value);
    const modeWeeks = weeksByMode.get(value.mode) || new Map();
    modeWeeks.set(weekKey(value.yearMonth, value.weekNo), {
      yearMonth: value.yearMonth,
      weekNo: value.weekNo,
    });
    weeksByMode.set(value.mode, modeWeeks);
  }

  return preview.template.sections.map((section) => {
    const weeks = Array.from(weeksByMode.get(section.mode)?.values() || [])
      .sort(compareWeekLike);
    const rows = section.lineRows.map((line) => {
      const cells = weeks.map((week) => {
        const value = valueIndex.get(previewValueKey({
          mode: section.mode,
          lineId: line.lineId,
          yearMonth: week.yearMonth,
          weekNo: week.weekNo,
        }));
        return {
          ...week,
          a1: value?.a1 || '',
          sheetValue: value?.sheetValue || '',
          ...selectPreviewAmount(value),
        };
      });
      return { ...line, cells };
    });
    const inRows = rows.filter((row) => row.direction === 'IN');
    const outRows = rows.filter((row) => row.direction === 'OUT');
    const sumRows = (targetRows: typeof rows, index: number) => targetRows.reduce((total, row) => (
      total + (row.cells[index]?.displayAmount || 0)
    ), 0);
    const totalIn = weeks.map((_, index) => sumRows(inRows, index));
    const totalOut = weeks.map((_, index) => sumRows(outRows, index));
    let runningBalance = 0;
    const balances = weeks.map((_, index) => {
      runningBalance += totalIn[index] - totalOut[index];
      return runningBalance;
    });
    const nonEmptyCellCount = rows.reduce((count, row) => count + row.cells.filter((cell) => (
      typeof cell.sheetAmount === 'number'
      || typeof cell.reflectedAmount === 'number'
      || cell.sheetValue.trim()
    )).length, 0);
    return {
      mode: section.mode,
      weeks,
      inRows,
      outRows,
      totalIn,
      totalOut,
      balances,
      nonEmptyCellCount,
    };
  });
}

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'error'; children: string }) {
  const className = tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-red-200 bg-red-50 text-red-800';
  return (
    <span className={`inline-flex h-7 items-center rounded border px-2.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  );
}

function CashflowAmountCell({
  value,
}: {
  value: ReturnType<typeof buildCashflowPreviewTables>[number]['inRows'][number]['cells'][number];
}) {
  const hasDiff = typeof value.diff === 'number' && value.diff !== 0;
  const title = [
    value.a1 ? `셀: ${value.a1}` : '',
    value.sheetValue ? `원본 시트: ${value.sheetValue}` : '원본 시트: -',
    `Java Read Model: ${formatAmount(value.reflectedAmount)}`,
  ].filter(Boolean).join('\n');
  return (
    <td className="min-w-[112px] border-l border-slate-100 px-2 py-2 text-right tabular-nums" title={title}>
      <div className={hasDiff ? 'font-semibold text-red-700' : 'text-slate-950'}>
        {formatAmount(value.displayAmount)}
      </div>
      {hasDiff && (
        <div className="mt-0.5 text-[10px] text-red-600">
          차이 {formatAmount(value.diff)}
        </div>
      )}
    </td>
  );
}

export function CashflowSheetLabPage() {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const [searchParams] = useSearchParams();
  const initialProjectId = useMemo(() => (
    searchParams.get('projectId')?.trim()
    || authUser?.projectId
    || authUser?.projectIds?.[0]
    || readRecentPortalProjectIds()[0]
    || ''
  ), [authUser?.projectId, authUser?.projectIds, searchParams]);
  const [projectIdInput, setProjectIdInput] = useState(initialProjectId);
  const [sheetLink, setSheetLink] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [startWeek, setStartWeek] = useState('');
  const [endWeek, setEndWeek] = useState('');
  const [config, setConfig] = useState<CashflowSheetLabConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState(true);
  const [preview, setPreview] = useState<CashflowSheetLabPreviewResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const previewRequestRef = useRef(0);

  const projectId = projectIdInput.trim();
  const projectName = projectId || '프로젝트';
  const spreadsheetId = useMemo(() => extractSpreadsheetIdFromSheetInput(sheetLink), [sheetLink]);
  const actor = useMemo(() => ({
    uid: authUser?.uid || 'workspace-user',
    email: authUser?.email || '',
    role: authUser?.role || 'workspace_user',
    idToken: authUser?.idToken,
  }), [
    authUser?.uid,
    authUser?.email,
    authUser?.role,
    authUser?.idToken,
  ]);

  useEffect(() => {
    if (projectIdInput || !initialProjectId) return;
    setProjectIdInput(initialProjectId);
  }, [initialProjectId, projectIdInput]);

  useEffect(() => {
    if (!projectId) return;
    rememberRecentPortalProject(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !actor.email) return;
    let cancelled = false;
    setConfigLoading(true);
    setErrorMessage('');
    getCashflowSheetLabConfigViaBff({
      tenantId: orgId,
      actor,
      projectId,
    }).then((result) => {
      if (cancelled) return;
      const nextConfig = result.config || null;
      setConfig(nextConfig);
      setEditingConfig(!nextConfig);
      setSheetLink(nextConfig?.value || '');
      setSheetName(nextConfig?.sheetName || '');
      setStartWeek(nextConfig?.startWeek || '');
      setEndWeek(nextConfig?.endWeek || '');
    }).catch((error) => {
      if (!cancelled) setErrorMessage(formatError(error));
    }).finally(() => {
      if (!cancelled) setConfigLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [actor, orgId, projectId]);

  async function handleSaveConfig() {
    if (!projectId || !spreadsheetId || savingConfig) return null;
    setSavingConfig(true);
    setErrorMessage('');
    try {
      const result = await saveCashflowSheetLabConfigViaBff({
        tenantId: orgId,
        actor,
        projectId,
        value: sheetLink,
        sheetName: sheetName || undefined,
        startWeek: startWeek || undefined,
        endWeek: endWeek || undefined,
      });
      const nextConfig = result.config || null;
      setConfig(nextConfig);
      setEditingConfig(false);
      setSheetLink(nextConfig?.value || sheetLink);
      setSheetName(nextConfig?.sheetName || sheetName);
      setStartWeek(nextConfig?.startWeek || startWeek);
      setEndWeek(nextConfig?.endWeek || endWeek);
      return nextConfig;
    } catch (error) {
      setErrorMessage(formatError(error));
      return null;
    } finally {
      setSavingConfig(false);
    }
  }

  async function handlePreview() {
    if (!projectId || loading || editingConfig || !config) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoading(true);
    setErrorMessage('');
    try {
      const layoutResult = await previewCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        includeValues: false,
      });
      if (previewRequestRef.current !== requestId) return;
      setPreview(layoutResult);
      if (!sheetName && layoutResult.selectedSheetName) setSheetName(layoutResult.selectedSheetName);
      void previewCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        includeValues: true,
      }).then((valueResult) => {
        if (previewRequestRef.current === requestId) {
          setPreview(valueResult);
          setPreviewDialogOpen(true);
        }
      }).catch((error) => {
        if (previewRequestRef.current === requestId) setErrorMessage(formatError(error));
      });
    } catch (error) {
      setPreview(null);
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  const cashflowPreviewTables = useMemo(() => buildCashflowPreviewTables(preview), [preview]);

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-[12px] text-slate-500">
          <FileSpreadsheet className="h-4 w-4" />
          <span>{projectName}</span>
        </div>
        <h1 className="text-xl font-semibold text-slate-950">캐시플로우 시트 연동 검토</h1>
      </div>

      <section className="grid gap-3 border border-slate-200 bg-white p-4">
        <div className="grid gap-2 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Input
            value={projectIdInput}
            onChange={(event) => setProjectIdInput(event.target.value)}
            placeholder="Project ID"
            aria-label="Project ID"
            className="h-10 rounded-none text-[12px]"
          />
          {editingConfig ? (
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_140px_140px_auto_auto]">
              <Input
                value={sheetLink}
                onChange={(event) => setSheetLink(event.target.value)}
                placeholder="Google Sheet 링크"
                aria-label="Google Sheet 링크"
                className="h-10 rounded-none text-[12px]"
              />
              <Input
                value={sheetName}
                onChange={(event) => setSheetName(event.target.value)}
                placeholder="시트 탭 이름"
                aria-label="시트 탭 이름"
                className="h-10 rounded-none text-[12px]"
              />
              <Input
                value={startWeek}
                onChange={(event) => setStartWeek(event.target.value)}
                placeholder="시작 주차"
                aria-label="시작 주차"
                className="h-10 rounded-none text-[12px]"
              />
              <Input
                value={endWeek}
                onChange={(event) => setEndWeek(event.target.value)}
                placeholder="종료 주차"
                aria-label="종료 주차"
                className="h-10 rounded-none text-[12px]"
              />
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                disabled={!projectId || !spreadsheetId || savingConfig}
                onClick={handleSaveConfig}
              >
                {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />}
                설정 저장
              </Button>
              {config && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-none text-[12px]"
                  onClick={() => {
                    setEditingConfig(false);
                    setSheetLink(config.value);
                    setSheetName(config.sheetName || '');
                    setStartWeek(config.startWeek || '');
                    setEndWeek(config.endWeek || '');
                  }}
                >
                  취소
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
              <div className="min-w-0 border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="truncate text-[12px] font-medium text-slate-950">{config?.spreadsheetTitle || config?.spreadsheetId || '저장된 시트'}</div>
                <div className="mt-1 truncate text-[11px] text-slate-500">
                  {config?.sheetName || '-'} · {config?.startWeek || '시작 미지정'} ~ {config?.endWeek || '종료 미지정'} · {formatTimestamp(config?.updatedAt)}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                onClick={() => setEditingConfig(true)}
              >
                <Pencil className="h-4 w-4" />
                수정
              </Button>
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                disabled={!projectId || loading || configLoading}
                onClick={handlePreview}
              >
                {loading || configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                검토
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Spreadsheet ID</span>
          <code className="border border-slate-200 bg-slate-50 px-2 py-1">{spreadsheetId || config?.spreadsheetId || '-'}</code>
          <span>MYSC 시스템 계정 읽기 기준</span>
          {!editingConfig && <span>저장된 설정으로 검토</span>}
          {!editingConfig && <span>반영 범위: {config?.startWeek || '전체'} ~ {config?.endWeek || '전체'}</span>}
        </div>
        {errorMessage && (
          <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            <AlertCircle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">선택 시트</div>
              <div className="mt-1 truncate text-[13px] font-medium text-slate-950">{preview.selectedSheetName}</div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">구조</div>
              <div className="mt-1">
                <StatusPill tone={preview.template.supported ? 'ok' : 'error'}>
                  {preview.template.supported ? '지원 양식' : '확인 필요'}
                </StatusPill>
              </div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">좌표</div>
              <div className="mt-1 text-[13px] font-medium text-slate-950">
                {preview.template.stats.mappingCount.toLocaleString()}개
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">source: sheet_layout</div>
            </div>
            <div className="border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Java Read Model</div>
              <div className="mt-1">
                <StatusPill tone={preview.cashflowSnapshotStatus === 'ready' ? 'ok' : 'warn'}>
                  {preview.cashflowSnapshotStatus === 'ready'
                    ? '연결됨'
                    : preview.cashflowSnapshotStatus === 'pending'
                      ? '조회 중'
                      : '미연결'}
                </StatusPill>
              </div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">{preview.accessPolicy.valueSource}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
            <span>Google: {preview.accessPolicy.googleAuth}</span>
            <span>Scope: {preview.accessPolicy.googleScope}</span>
            <span>Role: {preview.accessPolicy.actorRolePolicy}</span>
            <span>Range: {preview.accessPolicy.sheetReadRange}</span>
            <span>Cache: {preview.accessPolicy.sheetPreviewCache}</span>
            <span>Tab: {preview.accessPolicy.sheetNamePolicy}</span>
            <span>Weeks: {preview.activeWeekRange?.startWeek || '전체'} ~ {preview.activeWeekRange?.endWeek || '전체'}</span>
            <Button
              type="button"
              variant="outline"
              className="ml-auto h-7 rounded-none px-2 text-[11px]"
              onClick={() => setPreviewDialogOpen(true)}
            >
              반영 미리보기
            </Button>
          </div>

          {preview.template.reasons.length > 0 && (
            <div className="border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">
              {preview.template.reasons.map((reason) => (
                <div key={`${reason.code}-${reason.mode || 'sheet'}`}>
                  {reason.message} {reason.lineIds?.length ? `(${reason.lineIds.join(', ')})` : ''}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {preview.template.sections.map((section) => (
              <div key={section.mode} className="border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <h2 className="text-[13px] font-semibold text-slate-950">{formatMode(section.mode)}</h2>
                  <span className="text-[11px] text-slate-500">
                    {section.weekColumns.length}주 · {section.lineRows.length}행
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">시트 라벨</th>
                        <th className="px-3 py-2 font-medium">매칭 기준</th>
                        <th className="px-3 py-2 font-medium">행</th>
                        <th className="px-3 py-2 font-medium">첫 주차</th>
                        <th className="px-3 py-2 font-medium">마지막 주차</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.lineRows.map((row) => (
                        <tr key={`${section.mode}-${row.lineId}`} className="border-t border-slate-100">
                          <td className="px-3 py-2 text-slate-900">{row.label}</td>
                          <td className="px-3 py-2 text-slate-700" title={row.lineId}>{row.canonicalLabel || row.label}</td>
                          <td className="px-3 py-2 text-slate-500">{row.a1}</td>
                          <td className="px-3 py-2 text-slate-500">{section.weekColumns[0]?.a1 || '-'}</td>
                          <td className="px-3 py-2 text-slate-500">{section.weekColumns.at(-1)?.a1 || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          <Dialog open={previewDialogOpen} onOpenChange={setPreviewDialogOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-none sm:max-w-[calc(100vw-2rem)] xl:max-w-7xl">
              <DialogHeader>
                <DialogTitle className="text-base">캐시플로우 반영 미리보기</DialogTitle>
                <DialogDescription>
                  {preview.selectedSheetName} · {preview.activeWeekRange?.startWeek || '전체'} ~ {preview.activeWeekRange?.endWeek || '전체'}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 sm:grid-cols-3">
                {cashflowPreviewTables.map((table) => (
                  <div key={table.mode} className="border border-slate-200 bg-white p-3">
                    <div className="text-[11px] text-slate-500">{formatMode(table.mode)}</div>
                    <div className="mt-1 text-[13px] font-semibold text-slate-950">
                      {table.weeks.length.toLocaleString()}주 · {table.nonEmptyCellCount.toLocaleString()}개 값
                    </div>
                    <div className="mt-1 text-[11px] text-slate-600">가로 스크롤로 전체 주차 확인</div>
                  </div>
                ))}
                <div className="border border-slate-200 bg-white p-3">
                  <div className="text-[11px] text-slate-500">Java Read Model</div>
                  <div className="mt-1">
                    <StatusPill tone={preview.cashflowSnapshotStatus === 'ready' ? 'ok' : 'warn'}>
                      {preview.cashflowSnapshotStatus === 'ready' ? '연결됨' : '미연결'}
                    </StatusPill>
                  </div>
                </div>
              </div>
              <div className="max-h-[66vh] space-y-4 overflow-y-auto pr-1">
                {cashflowPreviewTables.map((table) => (
                  <div key={table.mode} className="border border-slate-200 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                      <h3 className="text-[13px] font-semibold text-slate-950">{formatMode(table.mode)}</h3>
                      <span className="text-[11px] text-slate-500">
                        {table.weeks.length.toLocaleString()}주 · 원본 시트 값 기준
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table
                        className="text-left text-[11px]"
                        style={{ minWidth: `${260 + table.weeks.length * 112}px` }}
                      >
                        <thead className="sticky top-0 z-20 bg-slate-50 text-slate-500">
                          <tr>
                            <th className="sticky left-0 z-30 w-[260px] min-w-[260px] border-r border-slate-200 bg-slate-50 px-3 py-2 font-medium">
                              항목
                            </th>
                            {table.weeks.map((week) => (
                              <th
                                key={`${table.mode}-${weekKey(week.yearMonth, week.weekNo)}`}
                                className="min-w-[112px] border-l border-slate-100 px-2 py-2 text-right font-medium"
                              >
                                {formatWeekLabel(week.yearMonth, week.weekNo)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-emerald-50 text-emerald-900">
                            <td colSpan={table.weeks.length + 1} className="px-3 py-2 font-semibold">입금</td>
                          </tr>
                          {table.inRows.map((row) => (
                            <tr key={`${table.mode}-${row.lineId}`} className="border-t border-slate-100">
                              <td className="sticky left-0 z-10 w-[260px] min-w-[260px] border-r border-slate-200 bg-white px-3 py-2 text-slate-900" title={row.lineId}>
                                {row.canonicalLabel || row.label}
                              </td>
                              {row.cells.map((cell) => (
                                <CashflowAmountCell
                                  key={`${table.mode}-${row.lineId}-${weekKey(cell.yearMonth, cell.weekNo)}`}
                                  value={cell}
                                />
                              ))}
                            </tr>
                          ))}
                          <tr className="border-t border-slate-200 bg-emerald-50/70 font-semibold text-emerald-950">
                            <td className="sticky left-0 z-10 w-[260px] min-w-[260px] border-r border-slate-200 bg-emerald-50 px-3 py-2">
                              입금 합계
                            </td>
                            {table.totalIn.map((value, index) => (
                              <td key={`${table.mode}-total-in-${index}`} className="min-w-[112px] border-l border-slate-100 px-2 py-2 text-right tabular-nums">
                                {formatAmount(value)}
                              </td>
                            ))}
                          </tr>
                          <tr className="bg-rose-50 text-rose-900">
                            <td colSpan={table.weeks.length + 1} className="px-3 py-2 font-semibold">출금</td>
                          </tr>
                          {table.outRows.map((row) => (
                            <tr key={`${table.mode}-${row.lineId}`} className="border-t border-slate-100">
                              <td className="sticky left-0 z-10 w-[260px] min-w-[260px] border-r border-slate-200 bg-white px-3 py-2 text-slate-900" title={row.lineId}>
                                {row.canonicalLabel || row.label}
                              </td>
                              {row.cells.map((cell) => (
                                <CashflowAmountCell
                                  key={`${table.mode}-${row.lineId}-${weekKey(cell.yearMonth, cell.weekNo)}`}
                                  value={cell}
                                />
                              ))}
                            </tr>
                          ))}
                          <tr className="border-t border-slate-200 bg-rose-50/70 font-semibold text-rose-950">
                            <td className="sticky left-0 z-10 w-[260px] min-w-[260px] border-r border-slate-200 bg-rose-50 px-3 py-2">
                              출금 합계
                            </td>
                            {table.totalOut.map((value, index) => (
                              <td key={`${table.mode}-total-out-${index}`} className="min-w-[112px] border-l border-slate-100 px-2 py-2 text-right tabular-nums">
                                {formatAmount(value)}
                              </td>
                            ))}
                          </tr>
                          <tr className="border-t border-slate-300 bg-slate-100 font-semibold text-slate-950">
                            <td className="sticky left-0 z-10 w-[260px] min-w-[260px] border-r border-slate-200 bg-slate-100 px-3 py-2">
                              잔액
                            </td>
                            {table.balances.map((value, index) => (
                              <td key={`${table.mode}-balance-${index}`} className="min-w-[112px] border-l border-slate-200 px-2 py-2 text-right tabular-nums">
                                {formatAmount(value)}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {cashflowPreviewTables.every((table) => table.weeks.length === 0) && (
                  <div className="border border-slate-200 bg-white px-3 py-10 text-center text-[12px] text-slate-500">
                    반영 미리보기에 표시할 주차가 없습니다.
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </section>
      )}
    </div>
  );
}
