import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, Loader2, Search } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import { buildCashflowPreviewTables } from './cashflow-sheet-preview-tables';
import {
  applyCashflowSheetLabViaBff,
  extractSpreadsheetIdFromSheetInput,
  previewCashflowSheetLabViaBff,
  type CashflowSheetLabPreviewResult,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { readRecentPortalProjectIds, rememberRecentPortalProject } from '../../platform/portal-recent-projects';
import { recordDevtoolsLog } from '../../platform/devtools-transaction-log';

function formatMode(mode: string) {
  return mode === 'projection' ? 'Projection' : 'Actual';
}

function formatAmount(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatError(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string; message?: string }; requestId?: string; status?: number };
  const code = apiError?.body?.code || apiError?.body?.error;
  if (code === 'google_sheets_not_configured') {
    return '서버의 Google Sheets 서비스 계정이 설정되지 않았습니다. 관리자에게 환경 변수 설정을 요청하세요.';
  }
  if (code === 'google_sheet_service_account_forbidden') {
    return '시트를 시스템 계정에 공유해 주세요. 공유 후 다시 검토하면 됩니다.';
  }
  const bodyMessage = apiError?.body?.message;
  if (bodyMessage) {
    return [
      code ? `[${code}]` : '',
      bodyMessage,
      apiError.requestId ? `(requestId: ${apiError.requestId})` : '',
    ].filter(Boolean).join(' ');
  }
  if (error instanceof Error) return error.message;
  return '시트 구조를 확인하지 못했습니다.';
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

function formatDiffAmount(value: number) {
  if (!Number.isFinite(value)) return '-';
  if (value === 0) return '0원';
  return `${value > 0 ? '+' : '-'}${Math.abs(value).toLocaleString('ko-KR')}원`;
}

function isBffAuthError(error: unknown): boolean {
  const apiError = error as { status?: number; body?: { code?: unknown; error?: unknown } };
  const status = apiError?.status;
  const code = typeof apiError?.body?.code === 'string'
    ? apiError.body.code
    : typeof apiError?.body?.error === 'string'
      ? apiError.body.error
      : '';
  if (code === 'google_sheets_api_error') return false;
  return status === 401 || status === 403 || code === 'missing_bearer_token' || code === 'invalid_token';
}

function ReconciliationSummary({
  table,
}: {
  table: ReturnType<typeof buildCashflowPreviewTables>[number];
}) {
  const rows = [
    ...table.inRows.map((row) => ({ ...row, section: '입금', label: row.canonicalLabel || row.label })),
    { section: '입금', label: '입금 합계', sheetTotal: table.sheetIncomeTotal, reflectedTotal: table.reflectedIncomeTotal, diffTotal: table.reflectedIncomeTotal - table.sheetIncomeTotal },
    ...table.outRows.map((row) => ({ ...row, section: '출금', label: row.canonicalLabel || row.label })),
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
}: {
  projectIdOverride?: string;
} = {}) {
  const { user: authUser, loginWithGoogle } = useAuth();
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
  const [sheetLink, setSheetLink] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [startWeek, setStartWeek] = useState('');
  const [endWeek, setEndWeek] = useState('');
  const [preview, setPreview] = useState<CashflowSheetLabPreviewResult | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
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
  const requestLoginFlow = useCallback(async () => {
    logCashflowLab('auth.popup.start', {
      projectId,
      actorEmail: actor.email,
      hasIdToken: Boolean(actor.idToken),
    }, 'warn');
    const result = await loginWithGoogle();
    if (!result.success) {
      logCashflowLab('auth.popup.error', {
        projectId,
        actorEmail: actor.email,
        error: result.error || 'Google OAuth popup failed',
      }, 'warn');
      setErrorMessage(result.error || 'Google 계정 권한을 확인하지 못했습니다.');
      return false;
    }
    logCashflowLab('auth.popup.ok', {
      projectId,
      actorEmail: actor.email,
    });
    return true;
  }, [actor.email, actor.idToken, loginWithGoogle, projectId]);

  const resolveBffActor = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const firebaseAuthUser = getAuthInstance()?.currentUser;
    const firebaseToken = await firebaseAuthUser?.getIdToken(Boolean(options.forceRefresh)).catch((error) => {
      logCashflowLab('auth.token.resolve.error', {
        projectId,
        actorEmail: actor.email,
        forceRefresh: Boolean(options.forceRefresh),
        message: error instanceof Error ? error.message : String(error),
      }, 'warn');
      return undefined;
    });
    const resolvedToken = firebaseToken || actor.idToken;
    if (!resolvedToken) return null;
    if (firebaseToken || options.forceRefresh) {
      logCashflowLab('auth.token.resolve', {
        projectId,
        actorEmail: actor.email,
        tokenSource: firebaseToken ? 'firebase' : 'store',
        forceRefresh: Boolean(options.forceRefresh),
      });
    }
    return {
      ...actor,
      idToken: resolvedToken,
    };
  }, [actor, projectId]);

  const requestBffActorAfterAuth = useCallback(async (action: string) => {
    logCashflowLab(`${action}.bffAuth.popup.required`, {
      projectId,
      actorEmail: actor.email,
      hasStoredToken: Boolean(actor.idToken),
    }, 'warn');
    const popupOk = await requestLoginFlow();
    if (!popupOk) return null;
    const resolved = await resolveBffActor({ forceRefresh: true });
    if (!resolved?.idToken) {
      logCashflowLab(`${action}.bffAuth.token_missing`, { projectId }, 'warn');
      setErrorMessage('Google 로그인 후에도 서버 인증 토큰을 확인하지 못했습니다. 다시 시도해 주세요.');
      return null;
    }
    return resolved;
  }, [actor.email, actor.idToken, projectId, requestLoginFlow, resolveBffActor]);

  const requireBffActor = useCallback(async () => {
    let resolved = await resolveBffActor();
    if (!resolved?.idToken) {
      resolved = await requestBffActorAfterAuth('auth.required');
    }
    return resolved;
  }, [requestBffActorAfterAuth, resolveBffActor]);

  async function runWithBffAuthRetry<T>(
    action: string,
    operation: (requestActor: typeof actor) => Promise<T>,
  ): Promise<T | null> {
    const requestActor = await requireBffActor();
    if (!requestActor) return null;
    try {
      return await operation(requestActor);
    } catch (error) {
      if (!isBffAuthError(error)) {
        throw error;
      }
      logCashflowLab(`${action}.bffAuth.rejected`, {
        projectId,
        ...errorDiagnostics(error),
      }, 'warn');
      const retryActor = await requestBffActorAfterAuth(action);
      if (!retryActor) {
        throw error;
      }
      return operation(retryActor);
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

  async function handlePreview() {
    if (!projectId || loading || !spreadsheetId) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoading(true);
    setErrorMessage('');
    try {
      const previewSource = {
        value: sheetLink,
        sheetName: sheetName || undefined,
        startWeek: startWeek || undefined,
        endWeek: endWeek || undefined,
      };
      logCashflowLab('preview.start', {
        projectId,
        spreadsheetId,
        sheetName: previewSource.sheetName || null,
      });
      const layoutResult = await runWithBffAuthRetry('preview.layout', (requestActor) => (
        previewCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          ...previewSource,
          includeValues: false,
        })
      ));
      if (!layoutResult) return;
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
      void runWithBffAuthRetry('preview.values', (requestActor) => previewCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          ...previewSource,
          includeValues: true,
        })).then((valueResult) => {
        if (!valueResult) return;
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
      }).catch(async (error) => {
        if (previewRequestRef.current === requestId) {
          logCashflowLab('preview.values.error', { projectId, ...errorDiagnostics(error) }, 'warn');
          setErrorMessage(formatError(error));
        }
      });
    } catch (error) {
      logCashflowLab('preview.error', { projectId, spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setPreview(null);
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleApplySheetValues() {
    if (!projectId || loading || !spreadsheetId) return;
    const startedAt = Date.now();
    const idempotencyKey = `cashflow-sheet-lab-apply:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setLoading(true);
    setErrorMessage('');
    logCashflowLab('apply.sheet_values.start', {
      projectId,
      spreadsheetId,
    });
    try {
      const result = await runWithBffAuthRetry('apply.sheet_values', (requestActor) => (
        applyCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          value: sheetLink,
          sheetName: sheetName || undefined,
          startWeek: startWeek || undefined,
          endWeek: endWeek || undefined,
          idempotencyKey,
        })
      ));
      if (!result) return;
      if (result.accessPolicy && result.template && result.availableSheets && result.matrix && result.previewValues && result.cashflowSnapshotStatus) {
        setPreview({
          projectId: result.projectId,
          spreadsheetId: result.spreadsheetId,
          spreadsheetTitle: result.spreadsheetTitle,
          selectedSheetName: result.selectedSheetName,
          availableSheets: result.availableSheets,
          matrix: result.matrix,
          accessPolicy: result.accessPolicy,
          activeWeekRange: result.activeWeekRange,
          template: result.template,
          previewValues: result.previewValues,
          cashflowSnapshotStatus: result.cashflowSnapshotStatus,
          cashflowSnapshotError: result.cashflowSnapshotError,
        });
      }
      logCashflowLab('apply.sheet_values.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.selectedSheetName,
        appliedLineCount: result.appliedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logCashflowLab('apply.sheet_values.error', { projectId, durationMs: Date.now() - startedAt, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  const cashflowPreviewTables = useMemo(() => buildCashflowPreviewTables(preview), [preview]);
  const totalBasisLabel = preview?.activeWeekRange?.startWeek || preview?.activeWeekRange?.endWeek
    ? `${preview.activeWeekRange.startWeek || '전체'} ~ ${preview.activeWeekRange.endWeek || '전체'}`
    : '전체';

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <section className="grid gap-3 border border-slate-200 bg-white p-4">
        <div className="grid gap-2">
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
              variant="outline"
              className="h-10 gap-1.5 rounded-none text-[12px]"
              disabled={!projectId || loading || !spreadsheetId}
              onClick={() => void handlePreview()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              검토
            </Button>
            <Button
              type="button"
              className="h-10 gap-1.5 rounded-none text-[12px]"
              disabled={!projectId || loading || !spreadsheetId}
              onClick={() => void handleApplySheetValues()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
              시트 값 반영하기
            </Button>
          </div>
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
