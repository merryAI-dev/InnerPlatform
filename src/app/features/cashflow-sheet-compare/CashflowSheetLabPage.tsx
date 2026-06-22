import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, CheckCircle2, Copy, Loader2, Save, Search, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import { buildCashflowPreviewTables } from './cashflow-sheet-preview-tables';
import {
  extractSpreadsheetIdFromSheetInput,
  applyCashflowSheetLabViaBff,
  getCashflowSheetLabShareAccountViaBff,
  previewCashflowSheetLabViaBff,
  saveCashflowSheetLabConfigViaBff,
  stageCashflowSheetLabViaBff,
  type CashflowSheetLabShareAccountResult,
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
  const code = getErrorCode(error);
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

function getErrorCode(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string } };
  return apiError?.body?.code || apiError?.body?.error || '';
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

function buildSourceKey({
  projectId,
  value,
  sheetName,
  startWeek,
  endWeek,
}: {
  projectId: string;
  value: string;
  sheetName: string;
  startWeek: string;
  endWeek: string;
}) {
  return JSON.stringify({
    projectId: projectId.trim(),
    value: value.trim(),
    sheetName: sheetName.trim(),
    startWeek: startWeek.trim(),
    endWeek: endWeek.trim(),
  });
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
  const { activeProjectId, myProject } = usePortalStore();
  const { orgId } = useFirebase();
  const [searchParams] = useSearchParams();
  const portalProjectId = activeProjectId || myProject?.id || '';
  const initialProjectId = useMemo(() => (
    projectIdOverride?.trim()
    || searchParams.get('projectId')?.trim()
    || portalProjectId
    || authUser?.projectId
    || authUser?.projectIds?.[0]
    || readRecentPortalProjectIds()[0]
    || ''
  ), [authUser?.projectId, authUser?.projectIds, portalProjectId, projectIdOverride, searchParams]);
  const [projectIdInput, setProjectIdInput] = useState(initialProjectId);
  const [sheetLink, setSheetLink] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [startWeek, setStartWeek] = useState('');
  const [endWeek, setEndWeek] = useState('');
  const [preview, setPreview] = useState<CashflowSheetLabPreviewResult | null>(null);
  const [reviewedSourceKey, setReviewedSourceKey] = useState('');
  const [savedConfig, setSavedConfig] = useState<CashflowSheetLabShareAccountResult['config']>(null);
  const [systemAccountEmail, setSystemAccountEmail] = useState('');
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const [stageResult, setStageResult] = useState<{
    stagedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    riskLineCount: number;
  } | null>(null);
  const [reflectResult, setReflectResult] = useState<{
    appliedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    lastAppliedAt?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const previewRequestRef = useRef(0);

  const projectId = projectIdInput.trim();
  const spreadsheetId = useMemo(() => extractSpreadsheetIdFromSheetInput(sheetLink), [sheetLink]);
  const sourceKey = useMemo(() => buildSourceKey({
    projectId,
    value: sheetLink,
    sheetName,
    startWeek,
    endWeek,
  }), [endWeek, projectId, sheetLink, sheetName, startWeek]);
  const savedConfigSourceKey = useMemo(() => (
    savedConfig?.value
      ? buildSourceKey({
          projectId,
          value: savedConfig.value,
          sheetName: savedConfig.sheetName || '',
          startWeek: savedConfig.startWeek || '',
          endWeek: savedConfig.endWeek || '',
        })
      : ''
  ), [projectId, savedConfig]);
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
    if (projectIdInput || !portalProjectId) return;
    setProjectIdInput(portalProjectId);
  }, [portalProjectId, projectIdInput]);

  useEffect(() => {
    if (!projectId) return;
    rememberRecentPortalProject(projectId);
  }, [projectId]);

  async function handleLoadShareAccount() {
    if (!projectId || accountLoading) return;
    setAccountLoading(true);
    setStatusMessage('');
    try {
      const result = await runWithBffAuthRetry('share_account.load', (requestActor) => (
        getCashflowSheetLabShareAccountViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
        })
      ));
      if (!result) return;
      const email = result.systemAccountEmail || result.accessPolicy?.serviceAccountEmail || '';
      if (!email) {
        setErrorMessage('서버의 Google Sheets 서비스 계정 이메일을 확인하지 못했습니다.');
        return;
      }
      setSystemAccountEmail(email);
      setSavedConfig(result.config || null);
      if (result.config?.value) {
        setSheetLink(result.config.value);
        setSheetName(result.config.sheetName || '');
        setStartWeek(result.config.startWeek || '');
        setEndWeek(result.config.endWeek || '');
      }
      setStatusMessage(result.config?.value ? '이미 연결된 시트 설정을 불러왔습니다.' : '공유 계정을 확인했습니다.');
      logCashflowLab('share_account.load.ok', {
        projectId,
        hasSystemAccountEmail: true,
      });
    } catch (error) {
      logCashflowLab('share_account.load.error', { projectId, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
    } finally {
      setAccountLoading(false);
    }
  }

  function handleCopyShareAccount() {
    if (!systemAccountEmail) return;
    void navigator.clipboard?.writeText(systemAccountEmail).catch(() => undefined);
    setStatusMessage('공유 계정을 복사했습니다.');
    logCashflowLab('share_account.copy', { projectId, hasSystemAccountEmail: true });
  }

  async function handleSaveSheetConfig() {
    if (!projectId || loading || !spreadsheetId) return;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    setReviewedSourceKey('');
    setStageResult(null);
    setReflectResult(null);
    logCashflowLab('settings.save.start', {
      projectId,
      spreadsheetId,
      sheetName: sheetName || null,
    });
    try {
      const result = await runWithBffAuthRetry('settings.save', (requestActor) => (
        saveCashflowSheetLabConfigViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          value: sheetLink,
          sheetName: sheetName || undefined,
          startWeek: startWeek || undefined,
          endWeek: endWeek || undefined,
        })
      ));
      if (!result) return;
      setSavedConfig(result.config || null);
      const email = result.systemAccountEmail || result.accessPolicy?.serviceAccountEmail || systemAccountEmail;
      if (email) setSystemAccountEmail(email);
      setStatusMessage('시트 설정을 저장했습니다. 다음부터 이 값이 자동으로 불러와집니다.');
      logCashflowLab('settings.save.ok', {
        projectId,
        spreadsheetId: result.config?.spreadsheetId || spreadsheetId,
        sheetName: result.config?.sheetName || sheetName || null,
        hasConfigValue: Boolean(result.config?.value),
        configValueSpreadsheetId: result.config?.spreadsheetId || null,
        configStartWeek: result.config?.startWeek || null,
        configEndWeek: result.config?.endWeek || null,
        configured: Boolean(result.configured),
      });
    } catch (error) {
      logCashflowLab('settings.save.error', { projectId, spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  async function handlePreview() {
    if (!projectId || loading || !spreadsheetId) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    setReviewedSourceKey('');
    setStageResult(null);
    setReflectResult(null);
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
      const result = await runWithBffAuthRetry('preview.values', (requestActor) => (
        previewCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          ...previewSource,
          includeValues: true,
        })
      ));
      if (!result) return;
      if (previewRequestRef.current !== requestId) return;
      const nextSheetName = sheetName || result.selectedSheetName || '';
      setPreview(result);
      setReviewedSourceKey(buildSourceKey({
        projectId,
        value: sheetLink,
        sheetName: nextSheetName,
        startWeek,
        endWeek,
      }));
      setStatusMessage('검토가 완료되었습니다.');
      logCashflowLab('preview.values.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.selectedSheetName,
        authMode: result.accessPolicy.googleAuth,
        templateSupported: result.template.supported,
        mappingCount: result.template.stats.mappingCount,
        previewValueCount: result.previewValues.length,
      });
      if (!sheetName && result.selectedSheetName) setSheetName(result.selectedSheetName);
    } catch (error) {
      logCashflowLab('preview.error', { projectId, spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setPreview(null);
      setErrorMessage(formatError(error));
      if (getErrorCode(error) === 'google_sheet_service_account_forbidden') {
        void handleLoadShareAccount();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleStageSheetValues() {
    if (!projectId || loading || !spreadsheetId || !shareConfirmed || reviewedSourceKey !== sourceKey) return;
    const startedAt = Date.now();
    const idempotencyKey = `cashflow-sheet-lab-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
    logCashflowLab('stage.sheet_values.start', {
      projectId,
      spreadsheetId,
    });
    try {
      const result = await runWithBffAuthRetry('stage.sheet_values', (requestActor) => (
        stageCashflowSheetLabViaBff({
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
      setStageResult({
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
      });
      setReflectResult(null);
      setReviewedSourceKey(sourceKey);
      setStatusMessage('시트 변경 후보를 만들었습니다.');
      logCashflowLab('stage.sheet_values.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.selectedSheetName,
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logCashflowLab('stage.sheet_values.error', { projectId, durationMs: Date.now() - startedAt, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleReflectSheetValues() {
    if (!projectId || loading || !spreadsheetId || !shareConfirmed || !stageResult || reviewedSourceKey !== sourceKey) return;
    const startedAt = Date.now();
    const idempotencyKey = `cashflow-sheet-lab-apply:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
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
      setReflectResult({
        appliedLineCount: result.appliedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        lastAppliedAt: result.lastAppliedAt,
      });
      setStatusMessage(`캐시플로우에 ${result.appliedLineCount.toLocaleString()}건을 저장했습니다.`);
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
  const canPreview = Boolean(projectId && spreadsheetId && shareConfirmed && !loading);
  const canSaveConfig = Boolean(projectId && spreadsheetId && !loading);
  const canApply = Boolean(projectId && spreadsheetId && shareConfirmed && preview && reviewedSourceKey === sourceKey && !loading);
  const canReflect = Boolean(projectId && spreadsheetId && shareConfirmed && stageResult && reviewedSourceKey === sourceKey && !reflectResult && !loading);
  const hasSavedConfig = Boolean(savedConfig?.value);
  const isCurrentSheetConfigSaved = Boolean(savedConfigSourceKey && savedConfigSourceKey === sourceKey);
  const activeStep = stageResult ? 5 : preview ? 4 : spreadsheetId ? 3 : shareConfirmed ? 2 : systemAccountEmail ? 1 : 0;
  const stepNumberClass = (step: number) =>
    `z-10 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold transition-colors ${
      step <= activeStep
        ? 'bg-[#001e46] text-white shadow-[0_0_0_4px_rgba(0,30,70,0.08)]'
        : 'bg-slate-100 text-slate-500'
    }`;
  const primaryCta = !preview && !isCurrentSheetConfigSaved && spreadsheetId
    ? {
        label: '시트 설정 우선 저장',
        disabled: !canSaveConfig,
        action: () => void handleSaveSheetConfig(),
      }
    : !preview
    ? {
        label: '시트 검토하기',
        disabled: !canPreview,
        action: () => void handlePreview(),
      }
    : !stageResult
      ? {
          label: '검토 후보 만들기',
          disabled: !canApply,
          action: () => void handleStageSheetValues(),
        }
      : {
          label: reflectResult ? '값 저장 완료' : '캐시플로우에 값 저장',
          disabled: !canReflect,
          action: () => void handleReflectSheetValues(),
        };

  return (
    <div className="bg-white px-5 pb-28 pt-6 sm:bg-slate-100 sm:px-6">
      <section className="mx-auto max-w-[560px] bg-white sm:border sm:border-slate-200 sm:p-8 sm:shadow-sm">
        <header>
          <div className="text-[12px] font-semibold text-slate-500">시트 연동 검토</div>
          <h1 className="mt-5 whitespace-pre-line text-[30px] font-bold leading-[1.25] tracking-normal text-slate-950 sm:text-[34px]">
            {`Google Sheet 값을\n검토 후보로 가져오기`}
          </h1>
          <div className="mt-3 text-[13px] text-slate-500">현재 사업 {projectId || '-'}</div>
        </header>

        {hasSavedConfig && (
          <div className="mt-6 border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
            <div className="font-bold">이미 연결된 시트 설정이 있습니다.</div>
            <div className="mt-1 text-[12px] text-blue-900">
              기존 설정으로 다시 검토하거나, 값을 바꾼 뒤 검토 후보를 만들 수 있습니다.
            </div>
            <div className="mt-1 text-[12px] text-blue-900">
              {savedConfig?.sheetName || '시트 탭'} · {savedConfig?.startWeek || '전체'} ~ {savedConfig?.endWeek || '전체'}
            </div>
            <div className="mt-1 break-all text-[11px] text-blue-800">
              {savedConfig?.spreadsheetTitle || savedConfig?.spreadsheetId || savedConfig?.value}
            </div>
          </div>
        )}

        <ol className="relative mt-10 space-y-8 before:absolute before:left-[17px] before:bottom-6 before:top-8 before:w-px before:bg-slate-200">
          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(1)}>1</span>
            <div className="min-w-0 space-y-3 pb-1">
              <h2 className="text-[19px] font-bold text-slate-950">공유 계정 확인</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px]"
                  disabled={!projectId || accountLoading}
                  onClick={() => void handleLoadShareAccount()}
                >
                  {accountLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  공유 계정 확인
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px]"
                  disabled={!systemAccountEmail}
                  onClick={handleCopyShareAccount}
                >
                  <Copy className="h-3.5 w-3.5" />
                  공유 계정 복사
                </Button>
              </div>
              {systemAccountEmail && (
                <div className="break-all border border-blue-100 bg-blue-50 px-3 py-2 font-mono text-[12px] text-blue-900">
                  {systemAccountEmail}
                </div>
              )}
              <div className="space-y-2">
                <div className="text-[12px] text-slate-500">Google Sheet를 위 공유 계정에 보기 권한으로 공유한 뒤 아래 버튼을 누르세요.</div>
                <Button
                  type="button"
                  variant={shareConfirmed ? 'default' : 'outline'}
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px]"
                  disabled={!systemAccountEmail}
                  onClick={() => setShareConfirmed(true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {shareConfirmed ? '공유 완료 확인됨' : '공유 완료 확인하기'}
                </Button>
              </div>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(2)}>2</span>
            <div className="min-w-0 space-y-2 pb-1">
              <h2 className="text-[19px] font-bold text-slate-950">시트 링크 입력</h2>
              <Input
                value={sheetLink}
                onChange={(event) => setSheetLink(event.target.value)}
                placeholder="Google Sheet 링크"
                aria-label="Google Sheet 링크"
                className="h-11 rounded-none text-[13px]"
              />
              <div className="grid gap-2 sm:grid-cols-3">
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
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  variant={isCurrentSheetConfigSaved ? 'outline' : 'default'}
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px]"
                  disabled={!canSaveConfig || isCurrentSheetConfigSaved}
                  onClick={() => void handleSaveSheetConfig()}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {isCurrentSheetConfigSaved ? '시트 설정 저장됨' : '시트 설정 우선 저장'}
                </Button>
                <div className="text-[12px] text-slate-500">
                  링크, 탭 이름, 주차 범위만 저장합니다. 캐시플로우 값은 바뀌지 않습니다.
                </div>
              </div>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(3)}>3</span>
            <div className="min-w-0 space-y-3 pb-1">
              <h2 className="text-[19px] font-bold text-slate-950">시트 값 검토</h2>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none px-4 text-[13px]"
                disabled={!canPreview}
                onClick={() => void handlePreview()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                검토
              </Button>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(4)}>4</span>
            <div className="min-w-0 space-y-3 pb-1">
              <h2 className="text-[19px] font-bold text-slate-950">검토 후보 생성</h2>
              <Button
                type="button"
                className="h-10 gap-1.5 rounded-none px-4 text-[13px]"
                disabled={!canApply}
                onClick={() => void handleStageSheetValues()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
                검토 후보 만들기
              </Button>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(5)}>5</span>
            <div className="min-w-0 space-y-3 pb-1">
              <h2 className="text-[19px] font-bold text-slate-950">캐시플로우 값 저장</h2>
              {stageResult ? (
                <div className="space-y-3">
                  <div className="text-[13px] font-semibold text-emerald-800">
                    후보 {stageResult.stagedLineCount.toLocaleString()}건
                    {' · '}Projection {stageResult.projectionLineCount.toLocaleString()}건
                    {' · '}Actual {stageResult.actualLineCount.toLocaleString()}건
                    {stageResult.riskLineCount > 0 ? ` · 확인 필요 ${stageResult.riskLineCount.toLocaleString()}건` : ''}
                  </div>
                  {reflectResult ? (
                    <div className="space-y-3">
                      <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                        반영 완료 · 실제 저장 {reflectResult.appliedLineCount.toLocaleString()}건
                        {' · '}Projection {reflectResult.projectionLineCount.toLocaleString()}건
                        {' · '}Actual {reflectResult.actualLineCount.toLocaleString()}건
                      </div>
                      <Button asChild variant="outline" className="h-9 rounded-none px-3 text-[12px]">
                        <Link to="/portal/cashflow">캐시플로우로 이동</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                        아래 버튼을 누르면 현재 Google Sheet 값을 캐시플로우에 저장하고 실제 값이 바뀝니다.
                      </div>
                      <Button
                        type="button"
                        className="h-10 gap-1.5 rounded-none px-4 text-[13px]"
                        disabled={!canReflect}
                        onClick={() => void handleReflectSheetValues()}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        캐시플로우에 값 저장
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[13px] text-slate-400">검토 후보를 만든 뒤 캐시플로우에 값을 저장할 수 있습니다.</div>
              )}
            </div>
          </li>
        </ol>

        {errorMessage && (
          <div className="mt-6 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
            <AlertCircle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
        )}
        {statusMessage && (
          <div className="mt-3 flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            <span>{statusMessage}</span>
          </div>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:hidden">
        <Button
          type="button"
          className="h-14 w-full rounded-[14px] bg-blue-600 text-[16px] font-bold text-white hover:bg-blue-700"
          disabled={primaryCta.disabled}
          onClick={primaryCta.action}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {primaryCta.label}
        </Button>
      </div>

      {preview && (
        <section className="mx-auto mt-4 max-w-6xl space-y-4">
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
