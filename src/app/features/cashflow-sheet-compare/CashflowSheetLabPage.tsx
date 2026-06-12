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
  type CashflowSheetLabPreviewResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { readRecentPortalProjectIds, rememberRecentPortalProject } from '../../platform/portal-recent-projects';

function formatMode(mode: string) {
  return mode === 'projection' ? 'Projection' : 'Actual';
}

function formatAmount(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function columnName(columnIndex: number) {
  let n = columnIndex + 1;
  let name = '';
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetCellKey(rowIndex: number, columnIndex: number) {
  return `${rowIndex}:${columnIndex}`;
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

function CashflowSheetGrid({ preview }: { preview: CashflowSheetLabPreviewResult }) {
  const valueByCell = useMemo(() => {
    const map = new Map<string, CashflowSheetLabPreviewResult['previewValues'][number]>();
    for (const value of preview.previewValues) {
      map.set(sheetCellKey(value.rowIndex, value.columnIndex), value);
    }
    return map;
  }, [preview.previewValues]);
  const maxColumnCount = Math.max(
    preview.template.stats.maxColumnCount,
    ...preview.template.sections.flatMap((section) => section.weekColumns.map((week) => week.columnIndex + 1)),
    1,
  );
  const rows = preview.matrix.length ? preview.matrix : [[]];
  const columnIndexes = Array.from({ length: Math.min(maxColumnCount, 90) }, (_, index) => index);

  return (
    <div className="border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-[13px] font-semibold text-slate-950">시트 좌표 미리보기</h2>
        <span className="text-[11px] text-slate-500">
          {rows.length.toLocaleString()}행 · {maxColumnCount.toLocaleString()}열
        </span>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="border-separate border-spacing-0 text-left text-[11px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 h-7 min-w-12 border-b border-r border-slate-200 bg-slate-100 px-2 text-center font-medium text-slate-500">
                #
              </th>
              {columnIndexes.map((columnIndex) => (
                <th key={columnIndex} className="sticky top-0 z-20 h-7 min-w-24 border-b border-r border-slate-200 bg-slate-100 px-2 text-center font-medium text-slate-500">
                  {columnName(columnIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th className="sticky left-0 z-10 h-8 border-b border-r border-slate-200 bg-slate-50 px-2 text-right font-medium text-slate-500">
                  {rowIndex + 1}
                </th>
                {columnIndexes.map((columnIndex) => {
                  const mapped = valueByCell.get(sheetCellKey(rowIndex, columnIndex));
                  const raw = row[columnIndex] || '';
                  const display = mapped ? formatAmount(mapped.amount) : raw;
                  const title = [
                    `${columnName(columnIndex)}${rowIndex + 1}`,
                    raw ? `원본: ${raw}` : '원본: 빈 셀',
                    mapped ? `매칭: ${mapped.label || mapped.canonicalLabel || mapped.lineId}` : '',
                    mapped ? `Java: ${formatAmount(mapped.amount)}` : '',
                  ].filter(Boolean).join('\n');
                  return (
                    <td
                      key={columnIndex}
                      title={title}
                      className={`h-8 max-w-40 truncate border-b border-r px-2 tabular-nums ${
                        mapped
                          ? 'border-emerald-200 bg-emerald-50 text-slate-950'
                          : raw
                            ? 'border-slate-200 bg-white text-slate-700'
                            : 'border-slate-100 bg-white text-slate-300'
                      }`}
                    >
                      {display || ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {maxColumnCount > columnIndexes.length && (
          <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            화면 성능을 위해 앞쪽 {columnIndexes.length}개 열만 표시했습니다.
          </div>
        )}
      </div>
    </div>
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
  const [config, setConfig] = useState<CashflowSheetLabConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState(true);
  const [preview, setPreview] = useState<CashflowSheetLabPreviewResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
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
      });
      const nextConfig = result.config || null;
      setConfig(nextConfig);
      setEditingConfig(false);
      setSheetLink(nextConfig?.value || sheetLink);
      setSheetName(nextConfig?.sheetName || sheetName);
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
        if (previewRequestRef.current === requestId) setPreview(valueResult);
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
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_240px_auto_auto]">
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
                  {config?.sheetName || '-'} · {formatTimestamp(config?.updatedAt)}
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

          <CashflowSheetGrid preview={preview} />

          <div className="border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <h2 className="text-[13px] font-semibold text-slate-950">Java 값 미리보기</h2>
              <span className="text-[11px] text-slate-500">
                {preview.previewValues.length.toLocaleString()}개 좌표
              </span>
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[760px] text-left text-[11px]">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">시트 라벨</th>
                    <th className="px-3 py-2 font-medium">매칭 기준</th>
                    <th className="px-3 py-2 font-medium">주차</th>
                    <th className="px-3 py-2 font-medium">셀</th>
                    <th className="px-3 py-2 font-medium">원본</th>
                    <th className="px-3 py-2 text-right font-medium">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previewValues.slice(0, 36).map((value) => (
                    <tr key={`${value.mode}-${value.lineId}-${value.yearMonth}-${value.weekNo}-${value.a1}`} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{formatMode(value.mode)}</td>
                      <td className="px-3 py-2 text-slate-900">{value.label || value.canonicalLabel || value.lineId}</td>
                      <td className="px-3 py-2 text-slate-500" title={value.lineId}>{value.canonicalLabel || value.label || '-'}</td>
                      <td className="px-3 py-2 text-slate-500">{value.yearMonth} W{value.weekNo}</td>
                      <td className="px-3 py-2 text-slate-500">{value.a1}</td>
                      <td className="max-w-48 truncate px-3 py-2 text-slate-500" title={value.sheetValue}>{value.sheetValue || '-'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-900">{formatAmount(value.amount)}</td>
                    </tr>
                  ))}
                  {preview.previewValues.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-[12px] text-slate-500">
                        표시할 좌표가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
