import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUpToLine, Loader2, Pencil, Search, Settings } from 'lucide-react';
import Lottie from 'lottie-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { buildCashflowPreviewTables } from './cashflow-sheet-preview-tables';
import {
  applyCashflowProjectionWritebackViaBff,
  extractSpreadsheetIdFromSheetInput,
  getCashflowSheetLabConfigViaBff,
  previewCashflowProjectionWritebackViaBff,
  previewCashflowSheetLabViaBff,
  saveCashflowSheetLabConfigViaBff,
  type CashflowSheetLabConfig,
  type CashflowSheetLabProjectionWritebackResult,
  type CashflowSheetLabPreviewResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { readRecentPortalProjectIds, rememberRecentPortalProject } from '../../platform/portal-recent-projects';
import { recordDevtoolsLog } from '../../platform/devtools-transaction-log';
import { RollingAmount } from '../../components/ui/rolling-amount';
import { sheetWritebackAnimation } from './sheet-writeback-animation';

const MYSC_CASHFLOW_SPREADSHEET_ID = '1cXi5FD--brA2dCdtNBsxJaIacd3FdcdsuZh2WuclsSQ';

function formatMode(mode: string) {
  return mode === 'projection' ? 'Projection' : 'Actual';
}

function formatAmount(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatError(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string; message?: string }; requestId?: string; status?: number };
  const bodyMessage = apiError?.body?.message;
  if (bodyMessage) {
    return [
      apiError.body?.code || apiError.body?.error ? `[${apiError.body.code || apiError.body.error}]` : '',
      bodyMessage,
      apiError.requestId ? `(requestId: ${apiError.requestId})` : '',
    ].filter(Boolean).join(' ');
  }
  if (error instanceof Error) return error.message;
  return '시트 구조를 확인하지 못했습니다.';
}

function extractWritebackConflict(error: unknown): CashflowSheetLabProjectionWritebackResult | null {
  const apiError = error as { body?: { details?: unknown } };
  const details = apiError?.body?.details;
  if (details && typeof details === 'object' && (details as CashflowSheetLabProjectionWritebackResult).plan) {
    return details as CashflowSheetLabProjectionWritebackResult;
  }
  return null;
}

function logCashflowLab(event: string, details: Record<string, unknown>, level: 'info' | 'warn' = 'info') {
  recordDevtoolsLog({
    kind: 'cashflow_transaction',
    phase: level === 'warn' ? 'error' : 'info',
    operation: `cashflow.sheet_lab.${event}`,
    transport: 'bff',
    projectId: typeof details.projectId === 'string' ? details.projectId : undefined,
    durationMs: typeof details.durationMs === 'number' ? details.durationMs : undefined,
    summary: details,
  });
}

function errorDiagnostics(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string; message?: string }; requestId?: string; status?: number; message?: string };
  return {
    status: apiError?.status || null,
    code: apiError?.body?.code || apiError?.body?.error || null,
    message: apiError?.body?.message || apiError?.message || 'Unknown error',
    requestId: apiError?.requestId || null,
  };
}

function isGoogleSheetsTokenExpiredError(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string; message?: string }; status?: number };
  const code = apiError?.body?.code || apiError?.body?.error;
  const message = apiError?.body?.message || '';
  return (apiError?.status === 401 || apiError?.status === 403)
    && (code === 'google_sheets_api_error' || message.includes('Google Sheets API request failed'));
}

function createGoogleSheetsAccessRequiredError() {
  return new Error('Google Sheets 권한 연결이 필요합니다. Google 계정 권한 요청 창을 완료한 뒤 다시 시도해 주세요.');
}

function formatDiffAmount(value: number) {
  if (!Number.isFinite(value)) return '-';
  if (value === 0) return '0원';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toLocaleString('ko-KR')}원`;
}

function formatDurationMs(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}초`;
}

function SheetWritebackIllustration() {
  return (
    <div className="relative mx-8 mt-5 overflow-hidden rounded-[26px] bg-gradient-to-br from-white via-slate-50 to-cyan-50 px-5 pb-5 pt-4 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.72)]">
      <div className="flex min-h-[138px] items-center justify-end">
        <Lottie
          animationData={sheetWritebackAnimation}
          loop
          autoplay
          className="h-[132px] w-[190px] shrink-0"
          aria-label="Google Sheet 업데이트 일러스트"
        />
      </div>
    </div>
  );
}

function ReconciliationSummary({
  table,
}: {
  table: ReturnType<typeof buildCashflowPreviewTables>[number];
}) {
  const rows = [
    ...table.inRows.map((row) => ({ section: '입금', label: row.canonicalLabel || row.label, ...row })),
    { section: '입금', label: '입금 합계', sheetTotal: table.sheetIncomeTotal, reflectedTotal: table.reflectedIncomeTotal, diffTotal: table.reflectedIncomeTotal - table.sheetIncomeTotal },
    ...table.outRows.map((row) => ({ section: '출금', label: row.canonicalLabel || row.label, ...row })),
    { section: '출금', label: '출금 합계', sheetTotal: table.sheetExpenseTotal, reflectedTotal: table.reflectedExpenseTotal, diffTotal: table.reflectedExpenseTotal - table.sheetExpenseTotal },
    {
      section: '잔액',
      label: '잔액',
      sheetTotal: table.sheetIncomeTotal - table.sheetExpenseTotal,
      reflectedTotal: table.reflectedIncomeTotal - table.reflectedExpenseTotal,
      diffTotal: (table.reflectedIncomeTotal - table.reflectedExpenseTotal) - (table.sheetIncomeTotal - table.sheetExpenseTotal),
    },
  ];

  return (
    <div className="border-b border-slate-200 bg-slate-50/60">
      <div className="grid gap-2 border-b border-slate-200 px-3 py-2 sm:grid-cols-4">
        <div>
          <div className="text-[10px] text-slate-500">시트 입금</div>
          <div className="text-[13px] font-semibold text-emerald-700">{formatAmount(table.sheetIncomeTotal)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">시트 출금</div>
          <div className="text-[13px] font-semibold text-rose-700">{formatAmount(table.sheetExpenseTotal)}</div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">순차이</div>
          <div className="text-[13px] font-semibold text-slate-950">
            {formatDiffAmount((table.reflectedIncomeTotal - table.reflectedExpenseTotal) - (table.sheetIncomeTotal - table.sheetExpenseTotal))}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">시트 기준 추가 주차</div>
          <div className="text-[12px] font-medium text-slate-700">
            {table.invalidWeeks.length ? table.invalidWeeks.join(', ') : '-'}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[11px]">
          <thead className="bg-white text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-left font-medium">항목</th>
              <th className="px-3 py-2 text-right font-medium">시트 원본</th>
              <th className="px-3 py-2 text-right font-medium">현재 저장값</th>
              <th className="px-3 py-2 text-right font-medium">차이</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const diff = row.diffTotal || 0;
              return (
                <tr key={`${table.mode}-${row.section}-${row.label}`} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{row.section}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{row.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.sheetTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatAmount(row.reflectedTotal)}</td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${diff === 0 ? 'text-slate-400' : 'text-red-700'}`}>
                    {formatDiffAmount(diff)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CashflowSheetLabPage({
  projectIdOverride,
  embedded = false,
  hideConfigChrome = false,
  onHeaderSummaryChange,
}: {
  projectIdOverride?: string;
  embedded?: boolean;
  hideConfigChrome?: boolean;
  onHeaderSummaryChange?: (summary: {
    spreadsheetTitle: string;
    sheetName: string;
    startWeek: string;
    endWeek: string;
  }) => void;
} = {}) {
  const { user: authUser, ensureGoogleWorkspaceAccess } = useAuth();
  const { orgId } = useFirebase();
  const [searchParams] = useSearchParams();
  const initialProjectId = useMemo(() => (
    projectIdOverride?.trim()
    || searchParams.get('projectId')?.trim()
    || authUser?.projectId
    || authUser?.projectIds?.[0]
    || readRecentPortalProjectIds()[0]
    || ''
  ), [authUser?.projectId, authUser?.projectIds, projectIdOverride, searchParams]);
  const [projectIdInput, setProjectIdInput] = useState(initialProjectId);
  const [sheetLink, setSheetLink] = useState(MYSC_CASHFLOW_SPREADSHEET_ID);
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
  const [syncWizardOpen, setSyncWizardOpen] = useState(false);
  const [writebackPreview, setWritebackPreview] = useState<CashflowSheetLabProjectionWritebackResult | null>(null);
  const [writebackLoading, setWritebackLoading] = useState(false);
  const [writebackApplying, setWritebackApplying] = useState(false);
  const [writebackMessage, setWritebackMessage] = useState('');
  const previewRequestRef = useRef(0);

  const projectId = projectIdInput.trim();
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
  const bffAuthReady = Boolean(actor.email && actor.idToken);

  async function resolveGoogleAccessToken(action: string, options: { forceRefresh?: boolean } = {}) {
    if (authUser?.googleAccessToken && !options.forceRefresh) {
      logCashflowLab(`${action}.googleToken.cached`, { projectId, hasGoogleAccessToken: true });
      return authUser.googleAccessToken;
    }
    logCashflowLab(`${action}.googleToken.request`, { projectId, hasGoogleAccessToken: false, forceRefresh: Boolean(options.forceRefresh) });
    const token = await ensureGoogleWorkspaceAccess({ forceRefresh: Boolean(options.forceRefresh) });
    logCashflowLab(`${action}.googleToken.result`, {
      projectId,
      hasGoogleAccessToken: Boolean(token),
      authMode: token ? 'token_pass_through' : 'google_token_required',
      forceRefresh: Boolean(options.forceRefresh),
    }, token ? 'info' : 'warn');
    if (!token) throw createGoogleSheetsAccessRequiredError();
    return token;
  }

  async function runWithGoogleSheetsAuthRetry<T>(
    action: string,
    operation: (googleAccessToken: string) => Promise<T>,
    options: { forceRefresh?: boolean } = {},
  ): Promise<T> {
    const googleAccessToken = await resolveGoogleAccessToken(action, { forceRefresh: Boolean(options.forceRefresh) });
    try {
      return await operation(googleAccessToken);
    } catch (error) {
      if (!isGoogleSheetsTokenExpiredError(error)) {
        throw error;
      }
      logCashflowLab(`${action}.googleToken.expired`, { projectId, ...errorDiagnostics(error) }, 'warn');
      const refreshedToken = await resolveGoogleAccessToken(action, { forceRefresh: true });
      return operation(refreshedToken);
    }
  }

  useEffect(() => {
    if (projectIdInput || !initialProjectId) return;
    setProjectIdInput(initialProjectId);
  }, [initialProjectId, projectIdInput]);

  useEffect(() => {
    const nextProjectId = projectIdOverride?.trim();
    if (!nextProjectId || nextProjectId === projectIdInput) return;
    setProjectIdInput(nextProjectId);
  }, [projectIdInput, projectIdOverride]);

  useEffect(() => {
    if (!projectId) return;
    rememberRecentPortalProject(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !bffAuthReady) return;
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
      setSheetLink(nextConfig?.value || MYSC_CASHFLOW_SPREADSHEET_ID);
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
  }, [actor, bffAuthReady, orgId, projectId]);

  async function handleSaveConfig() {
    if (!projectId || !spreadsheetId || savingConfig || !bffAuthReady) return null;
    setSavingConfig(true);
    setErrorMessage('');
    try {
      logCashflowLab('config.save.start', { projectId, spreadsheetId, sheetName: sheetName || null, startWeek: startWeek || null, endWeek: endWeek || null });
      let usedGoogleAccessToken: string | undefined;
      const result = await runWithGoogleSheetsAuthRetry('config.save', (googleAccessToken) => {
        usedGoogleAccessToken = googleAccessToken;
        return saveCashflowSheetLabConfigViaBff({
        tenantId: orgId,
        actor,
        projectId,
        value: sheetLink,
        sheetName: sheetName || undefined,
        startWeek: startWeek || undefined,
        endWeek: endWeek || undefined,
        googleAccessToken,
        });
      }, { forceRefresh: true });
      const nextConfig = result.config || null;
      setConfig(nextConfig);
      setEditingConfig(false);
      setSheetLink(nextConfig?.value || sheetLink);
      setSheetName(nextConfig?.sheetName || sheetName);
      setStartWeek(nextConfig?.startWeek || startWeek);
      setEndWeek(nextConfig?.endWeek || endWeek);
      logCashflowLab('config.save.ok', {
        projectId,
        spreadsheetId: nextConfig?.spreadsheetId || spreadsheetId,
        sheetName: nextConfig?.sheetName || sheetName || null,
        authMode: usedGoogleAccessToken ? 'token_pass_through' : 'service_account_fallback',
      });
      return nextConfig;
    } catch (error) {
      logCashflowLab('config.save.error', { projectId, spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
      return null;
    } finally {
      setSavingConfig(false);
    }
  }

  async function handlePreview() {
    if (!projectId || loading || editingConfig || !config || !bffAuthReady) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoading(true);
    setErrorMessage('');
    try {
      logCashflowLab('preview.start', { projectId, spreadsheetId: config?.spreadsheetId || spreadsheetId, sheetName: config?.sheetName || null });
      let usedGoogleAccessToken: string | undefined;
      const layoutResult = await runWithGoogleSheetsAuthRetry('preview', (googleAccessToken) => {
        usedGoogleAccessToken = googleAccessToken;
        return previewCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        includeValues: false,
        googleAccessToken,
        });
      });
      if (previewRequestRef.current !== requestId) return;
      setPreview(layoutResult);
      logCashflowLab('preview.layout.ok', {
        projectId,
        spreadsheetId: layoutResult.spreadsheetId,
        sheetName: layoutResult.selectedSheetName,
        authMode: layoutResult.accessPolicy.googleAuth,
        templateSupported: layoutResult.template.supported,
        mappingCount: layoutResult.template.stats.mappingCount,
      });
      if (!sheetName && layoutResult.selectedSheetName) setSheetName(layoutResult.selectedSheetName);
      void previewCashflowSheetLabViaBff({
        tenantId: orgId,
        actor,
        projectId,
        includeValues: true,
        googleAccessToken: usedGoogleAccessToken,
      }).then((valueResult) => {
        if (previewRequestRef.current === requestId) {
          setPreview(valueResult);
          logCashflowLab('preview.values.ok', {
            projectId,
            spreadsheetId: valueResult.spreadsheetId,
            sheetName: valueResult.selectedSheetName,
            authMode: valueResult.accessPolicy.googleAuth,
            previewValueCount: valueResult.previewValues.length,
          });
        }
      }).catch((error) => {
        if (previewRequestRef.current === requestId) {
          logCashflowLab('preview.values.error', { projectId, ...errorDiagnostics(error) }, 'warn');
          setErrorMessage(formatError(error));
        }
      });
    } catch (error) {
      logCashflowLab('preview.error', { projectId, spreadsheetId: config?.spreadsheetId || spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setPreview(null);
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  function openSyncWizard() {
    setSyncWizardOpen(true);
    setWritebackMessage('');
    setErrorMessage('');
  }

  async function handleWritebackPreview() {
    if (!projectId || writebackLoading || editingConfig || !config || !bffAuthReady) return null;
    const startedAt = Date.now();
    setWritebackLoading(true);
    setWritebackMessage('');
    setErrorMessage('');
    try {
      let usedGoogleAccessToken: string | undefined;
      const result = await runWithGoogleSheetsAuthRetry('writeback.preview', (googleAccessToken) => {
        usedGoogleAccessToken = googleAccessToken;
        return previewCashflowProjectionWritebackViaBff({
          tenantId: orgId,
          actor,
          projectId,
          googleAccessToken,
        });
      });
      setWritebackPreview(result);
      logCashflowLab('writeback.preview.ok', {
        projectId,
        authMode: usedGoogleAccessToken ? 'token_pass_through' : 'service_account_fallback',
        changeCount: result.plan.changeCount,
        baselineHash: result.plan.baselineHash,
        durationMs: result.durationMs || Date.now() - startedAt,
      });
      if (result.plan.changeCount === 0) {
        setWritebackMessage(`Google Sheet에 업데이트할 계획값이 없습니다. · ${formatDurationMs(result.durationMs || Date.now() - startedAt)}`);
      }
      return result;
    } catch (error) {
      logCashflowLab('writeback.preview.error', { projectId, durationMs: Date.now() - startedAt, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
      return null;
    } finally {
      setWritebackLoading(false);
    }
  }

  async function handleWritebackApply(overwrite = false) {
    if (!projectId || writebackApplying || editingConfig || !config || !bffAuthReady) return false;
    const startedAt = Date.now();
    const baselineHash = writebackPreview?.plan.baselineHash;
    setWritebackApplying(true);
    setWritebackMessage('');
    setErrorMessage('');
    const idempotencyKey = `cashflow-projection-writeback:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    try {
      let usedGoogleAccessToken: string | undefined;
      const result = await runWithGoogleSheetsAuthRetry('writeback.apply', (googleAccessToken) => {
        usedGoogleAccessToken = googleAccessToken;
        return applyCashflowProjectionWritebackViaBff({
          tenantId: orgId,
          actor,
          projectId,
          baselineHash,
          conflictResolution: overwrite ? 'overwrite' : 'abort',
          idempotencyKey,
          googleAccessToken,
        });
      });
      setWritebackPreview(result);
      setWritebackMessage(`시트 업데이트 완료: ${Number(result.updatedCellCount || 0).toLocaleString()}개 셀 · ${formatDurationMs(result.durationMs || Date.now() - startedAt)}`);
      logCashflowLab('writeback.apply.ok', {
        projectId,
        authMode: usedGoogleAccessToken ? 'token_pass_through' : 'service_account_fallback',
        updatedCellCount: result.updatedCellCount || 0,
        jobId: result.job?.id || null,
        durationMs: result.durationMs || Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      const conflict = extractWritebackConflict(error);
      if (conflict) {
        setWritebackPreview(conflict);
        setErrorMessage('Google Sheet가 검토 후에 변경되었습니다. 아래 값을 다시 확인한 뒤 시트 업데이트를 다시 눌러 주세요.');
      } else {
        setErrorMessage(formatError(error));
      }
      logCashflowLab('writeback.apply.error', { projectId, durationMs: Date.now() - startedAt, ...errorDiagnostics(error) }, 'warn');
      return false;
    } finally {
      setWritebackApplying(false);
    }
  }

  useEffect(() => {
    onHeaderSummaryChange?.({
      spreadsheetTitle: preview?.spreadsheetTitle || config?.spreadsheetTitle || '저장된 시트',
      sheetName: preview?.selectedSheetName || config?.sheetName || '',
      startWeek: preview?.activeWeekRange?.startWeek || config?.startWeek || '',
      endWeek: preview?.activeWeekRange?.endWeek || config?.endWeek || '',
    });
  }, [
    config?.endWeek,
    config?.sheetName,
    config?.spreadsheetTitle,
    config?.startWeek,
    onHeaderSummaryChange,
    preview?.activeWeekRange?.endWeek,
    preview?.activeWeekRange?.startWeek,
    preview?.selectedSheetName,
    preview?.spreadsheetTitle,
  ]);

  useEffect(() => {
    const handleToolbarAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string; projectId?: string }>).detail?.action;
      const targetProjectId = (event as CustomEvent<{ action?: string; projectId?: string }>).detail?.projectId;
      if (targetProjectId && targetProjectId !== projectId) return;
      if (action === 'apply') {
        openSyncWizard();
        void handleWritebackPreview();
      } else if (action === 'preview') {
        void handlePreview();
      } else if (action === 'edit') {
        setEditingConfig(true);
      } else if (action === 'projection-writeback') {
        openSyncWizard();
        void handleWritebackPreview();
      }
    };
    window.addEventListener('mysc:cashflow-sheet-lab-action', handleToolbarAction);
    return () => window.removeEventListener('mysc:cashflow-sheet-lab-action', handleToolbarAction);
  });

  useEffect(() => {
    const handleProjectionSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      openSyncWizard();
      void handleWritebackPreview();
    };
    window.addEventListener('mysc:cashflow-projection-saved', handleProjectionSaved);
    return () => window.removeEventListener('mysc:cashflow-projection-saved', handleProjectionSaved);
  });

  const cashflowPreviewTables = useMemo(() => buildCashflowPreviewTables(preview), [preview]);
  const totalBasisLabel = preview?.activeWeekRange?.startWeek || preview?.activeWeekRange?.endWeek
    ? `${preview.activeWeekRange.startWeek || '전체'} ~ ${preview.activeWeekRange.endWeek || '전체'}`
    : '전체';

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-4 sm:p-6'}>
      {(!hideConfigChrome || editingConfig || errorMessage) && (
      <section className="grid gap-3 border border-slate-200 bg-white p-4">
        <div className="grid gap-2">
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
                disabled={!projectId || !spreadsheetId || savingConfig || !bffAuthReady}
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
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <div className="min-w-0 border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="truncate text-[12px] font-medium text-slate-950">{config?.spreadsheetTitle || '저장된 시트'}</div>
              <div className="mt-1 truncate text-[11px] text-slate-500">
                  {config?.sheetName || '-'} · 합계 기준 {config?.startWeek || '시작 미지정'} ~ {config?.endWeek || '종료 미지정'}
                </div>
              </div>
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                disabled={writebackLoading || !config || !bffAuthReady}
                onClick={() => {
                  openSyncWizard();
                  void handleWritebackPreview();
                }}
              >
                {writebackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpToLine className="h-4 w-4" />}
                시트 업데이트
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                disabled={!projectId || loading || configLoading || !bffAuthReady}
                onClick={handlePreview}
              >
                {loading || configLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                검토
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none text-[12px]"
                onClick={() => setEditingConfig(true)}
              >
                <Pencil className="h-4 w-4" />
                수정
              </Button>
            </div>
          )}
        </div>
        {errorMessage && (
          <div className="flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            <AlertCircle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}
      </section>
      )}

      <Dialog open={syncWizardOpen} onOpenChange={setSyncWizardOpen}>
        <DialogContent className="!top-auto !bottom-0 !left-1/2 !w-[calc(100%-24px)] !max-w-[560px] !translate-y-0 !gap-0 overflow-hidden !rounded-b-none !rounded-t-[28px] !border-0 !bg-white !p-0 !shadow-[0_-18px_60px_rgba(15,23,42,0.22)] duration-300 data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:slide-in-from-bottom-8 sm:!bottom-6 sm:!w-[560px] sm:!rounded-[28px] [&>button]:hidden">
          <div className="mx-auto mt-3 h-1.5 w-16 rounded-full bg-slate-200" />
          <button
            type="button"
            className="absolute right-6 top-6 z-10 grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-[24px] leading-none text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
            aria-label="닫기"
            onClick={() => setSyncWizardOpen(false)}
          >
            ×
          </button>
          <SheetWritebackIllustration />
          <DialogHeader className="px-8 pb-4 pt-6 text-left">
            <DialogTitle className="text-[24px] font-bold leading-8 tracking-normal text-slate-950">
              시트에 반영할까요?
            </DialogTitle>
            <DialogDescription className="pt-1 text-[14px] leading-6 text-slate-500">
              저장한 계획 금액만 Google Sheet에 업데이트합니다.
              <br />
              Actual은 그대로 둡니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-8 pb-6 text-[13px]">
            {writebackLoading && !writebackPreview && (
              <div className="flex items-center gap-3 py-10 text-[14px] font-medium text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                변경될 금액을 확인하는 중입니다.
              </div>
            )}

            {writebackPreview && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-slate-400">대상 시트</div>
                    <div className="mt-1 max-w-[340px] truncate text-[14px] font-semibold text-slate-700">{writebackPreview.selectedSheetName}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[12px] font-medium text-slate-400">변경</div>
                    <div className="mt-1 text-[20px] font-bold leading-6 text-slate-950">
                      <RollingAmount value={`${writebackPreview.plan.changeCount.toLocaleString()}건`} />
                    </div>
                  </div>
                </div>
                {writebackPreview.plan.changedCells.length > 0 ? (
                  <div className="max-h-[280px] overflow-auto rounded-[18px] border border-slate-100 bg-slate-50">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-slate-50 text-slate-400">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold">항목</th>
                          <th className="px-4 py-3 text-left font-semibold">주차</th>
                          <th className="px-4 py-3 text-right font-semibold">현재</th>
                          <th className="px-4 py-3 text-right font-semibold">변경 후</th>
                        </tr>
                      </thead>
                      <tbody>
                        {writebackPreview.plan.changedCells.slice(0, 20).map((cell) => (
                          <tr key={`${cell.a1}-${cell.lineId}-${cell.yearMonth}-${cell.weekNo}`} className="border-t border-slate-100 bg-white">
                            <td className="px-4 py-4 text-slate-900">
                              <div className="max-w-[180px] truncate font-semibold">{cell.canonicalLabel || cell.label}</div>
                            </td>
                            <td className="px-4 py-4 text-left text-slate-500">{cell.yearMonth} · {cell.weekNo}주차</td>
                            <td className="px-4 py-4 text-right tabular-nums text-slate-500">
                              <RollingAmount value={formatAmount(cell.sheetAmount)} />
                            </td>
                            <td className="px-4 py-4 text-right text-[15px] font-bold tabular-nums text-blue-600">
                              <RollingAmount value={formatAmount(cell.platformAmount)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {writebackPreview.plan.omittedChangedCellCount > 0 && (
                      <div className="border-t border-slate-100 bg-white px-4 py-3 text-[12px] text-slate-500">
                        외 {writebackPreview.plan.omittedChangedCellCount.toLocaleString()}건이 더 있습니다.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-[18px] bg-slate-50 px-4 py-8 text-center text-[14px] font-medium text-slate-500">
                    업데이트할 값이 없습니다.
                  </div>
                )}
              </div>
            )}

            {writebackMessage && (
              <div className="rounded-[14px] bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">
                {writebackMessage}
              </div>
            )}
            {errorMessage && (
              <div className="flex items-center gap-2 rounded-[14px] bg-red-50 px-4 py-3 text-[13px] font-medium text-red-800">
                <AlertCircle className="h-4 w-4" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
          <DialogFooter className="grid grid-cols-[96px_minmax(0,1fr)] gap-0 border-t border-slate-100 p-0 sm:grid-cols-[120px_minmax(0,1fr)]">
            <Button type="button" variant="ghost" className="h-16 rounded-none text-[15px] font-semibold text-slate-500 hover:bg-slate-50" onClick={() => setSyncWizardOpen(false)}>
              아니요
            </Button>
            <Button
              type="button"
              className="h-16 rounded-none bg-blue-600 text-[16px] font-bold text-white hover:bg-blue-700"
              disabled={!writebackPreview || writebackPreview.plan.changeCount === 0 || writebackApplying}
              onClick={() => void handleWritebackApply(false)}
            >
              {writebackApplying ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ArrowUpToLine className="mr-1 h-4 w-4" />}
              반영하기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preview && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-medium text-slate-950">
                {preview.selectedSheetName}
              </div>
              <div className="text-[11px] text-slate-500">
                합계 기준 {totalBasisLabel}
              </div>
            </div>
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

          <div className="space-y-4">
            {cashflowPreviewTables.map((table) => (
              <div key={table.mode} className="border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <h3 className="text-[13px] font-semibold text-slate-950">{formatMode(table.mode)}</h3>
                  <span className="text-[11px] text-slate-500">{table.weeks.length.toLocaleString()}주</span>
                </div>
                <ReconciliationSummary table={table} />
              </div>
            ))}
            {cashflowPreviewTables.every((table) => table.weeks.length === 0) && (
              <div className="border border-slate-200 bg-white px-3 py-10 text-center text-[12px] text-slate-500">
                표시할 주차가 없습니다.
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
