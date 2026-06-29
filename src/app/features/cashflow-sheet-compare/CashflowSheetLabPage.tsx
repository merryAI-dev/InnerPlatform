import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Copy, HelpCircle, Loader2, Save, Search, UserPlus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import {
  extractSpreadsheetIdFromSheetInput,
  applyCashflowSheetLabViaBff,
  getCashflowSheetLabShareAccountViaBff,
  previewCashflowSheetLabViaBff,
  saveCashflowSheetLabConfigViaBff,
  stageCashflowSheetLabViaBff,
  type CashflowSheetLabShareAccountResult,
  type CashflowSheetLabPreviewResult,
  type CashflowSheetLabChangeCandidate,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { readRecentPortalProjectIds, rememberRecentPortalProject } from '../../platform/portal-recent-projects';
import { recordDevtoolsLog } from '../../platform/devtools-transaction-log';

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

function formatCandidateAmount(value: number | null, hadValue: boolean) {
  return hadValue ? formatAmount(value) : '미작성';
}

function formatCandidateWeek(candidate: CashflowSheetLabChangeCandidate) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(candidate.yearMonth || '');
  if (!match) return `${candidate.yearMonth} W${candidate.weekNo}`;
  return `${match[1].slice(2)}-${Number(match[2])}-${candidate.weekNo}`;
}

function getCandidateLineLabel(candidate: CashflowSheetLabChangeCandidate) {
  return CASHFLOW_SHEET_LINE_LABELS[candidate.lineId as CashflowSheetLineId] || candidate.sourceLabel || candidate.lineId;
}

function getCandidateDiff(candidate: CashflowSheetLabChangeCandidate) {
  const before = candidate.beforeHadValue ? Number(candidate.beforeAmount || 0) : 0;
  const proposed = candidate.proposedHadValue ? Number(candidate.proposedAmount || 0) : 0;
  return proposed - before;
}

function formatRiskFlag(flag: string) {
  if (flag === 'closed_week_change') return '결산 주차';
  if (flag === 'existing_actual_value') return '기존 Actual';
  return flag;
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

function HelpMemo({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="도움말"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] bg-slate-950 text-[11px] leading-relaxed text-white">
        {children}
      </TooltipContent>
    </Tooltip>
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
  const [stageResult, setStageResult] = useState<{
    runId: string;
    stagedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    riskLineCount: number;
    candidates: CashflowSheetLabChangeCandidate[];
    omittedCandidateCount: number;
  } | null>(null);
  const [reflectResult, setReflectResult] = useState<{
    appliedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    skippedRiskLineCount?: number;
    lastAppliedAt?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
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
      if (!result.config?.value) setStatusMessage('공유 계정을 확인했습니다.');
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
    if (!projectId || loading || !spreadsheetId || reviewedSourceKey !== sourceKey) return;
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
        runId: result.runId,
        stagedLineCount: result.stagedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        riskLineCount: result.riskLineCount,
        candidates: result.candidates || [],
        omittedCandidateCount: result.omittedCandidateCount || 0,
      });
      setReflectResult(null);
      setReviewedSourceKey(sourceKey);
      setApplyDialogOpen(true);
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
    if (!projectId || loading || !spreadsheetId || !stageResult || reviewedSourceKey !== sourceKey) return;
    const startedAt = Date.now();
    const idempotencyKey = `cashflow-sheet-lab-apply:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setLoading(true);
    setErrorMessage('');
    setStatusMessage('');
      logCashflowLab('apply.sheet_values.start', {
        projectId,
        spreadsheetId,
        stageRunId: stageResult.runId,
        safeStageLineCount,
        riskLineCount: stageResult.riskLineCount,
      });
    try {
      const result = await runWithBffAuthRetry('apply.sheet_values', (requestActor) => (
        applyCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          stageRunId: stageResult.runId,
          applyRiskCandidates: false,
          idempotencyKey,
        })
      ));
      if (!result) return;
      setReflectResult({
        appliedLineCount: result.appliedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        skippedRiskLineCount: result.skippedRiskLineCount,
        lastAppliedAt: result.lastAppliedAt,
      });
      setApplyDialogOpen(false);
      setStatusMessage(`검토한 값 ${result.appliedLineCount.toLocaleString()}건을 MYSCube에 저장했습니다.${result.skippedRiskLineCount ? ` 확인 필요 ${result.skippedRiskLineCount.toLocaleString()}건은 남겨두었습니다.` : ''}`);
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

  const totalBasisLabel = preview?.activeWeekRange?.startWeek || preview?.activeWeekRange?.endWeek
    ? `${preview.activeWeekRange.startWeek || '전체'} ~ ${preview.activeWeekRange.endWeek || '전체'}`
    : '전체';
  const canPreview = Boolean(projectId && spreadsheetId && !loading);
  const canSaveConfig = Boolean(projectId && spreadsheetId && !loading);
  const canApply = Boolean(projectId && spreadsheetId && preview && reviewedSourceKey === sourceKey && !loading);
  const safeStageLineCount = stageResult ? Math.max(0, stageResult.stagedLineCount - stageResult.riskLineCount) : 0;
  const stageCandidates = useMemo(() => {
    if (!stageResult) return [];
    return [...stageResult.candidates].sort((a, b) => (
      a.yearMonth.localeCompare(b.yearMonth)
      || a.weekNo - b.weekNo
      || a.mode.localeCompare(b.mode)
      || a.lineDirection.localeCompare(b.lineDirection)
      || a.lineId.localeCompare(b.lineId)
    ));
  }, [stageResult]);
  const canReflect = Boolean(projectId && spreadsheetId && stageResult && safeStageLineCount > 0 && reviewedSourceKey === sourceKey && !reflectResult && !loading);
  const hasSavedConfig = Boolean(savedConfig?.value);
  const showSetupSteps = !hasSavedConfig;
  const isCurrentSheetConfigSaved = Boolean(savedConfigSourceKey && savedConfigSourceKey === sourceKey);
  const linkedSheetName = savedConfig?.sheetName || preview?.selectedSheetName || sheetName || savedConfig?.spreadsheetTitle || '';
  const activeStep = stageResult ? 5 : preview ? 4 : spreadsheetId ? 3 : systemAccountEmail ? 2 : 0;
  const currentStep = reflectResult ? 5 : stageResult ? 5 : preview ? 4 : spreadsheetId ? 3 : systemAccountEmail ? 2 : 1;
  const stepNumberClass = (step: number) =>
    `z-10 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold transition-all duration-300 ${
      step <= activeStep
        ? 'bg-[#001e46] text-white shadow-[0_0_0_4px_rgba(0,30,70,0.08)]'
        : 'bg-slate-100 text-slate-500'
    } ${step === currentStep && !reflectResult ? 'ring-[6px] ring-blue-300 shadow-[0_0_0_8px_rgba(37,99,235,0.18)] motion-safe:animate-pulse' : ''}`;
  const primaryCta = !preview && !isCurrentSheetConfigSaved && spreadsheetId
    ? {
        label: '임시 저장',
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
        label: '전체 MYSCube에 저장하기',
          disabled: !canApply,
          action: () => void handleStageSheetValues(),
        }
      : {
          label: reflectResult ? '저장 완료' : safeStageLineCount > 0 ? '저장 확인 열기' : '저장할 변경 없음',
          disabled: !stageResult || !safeStageLineCount || Boolean(reflectResult) || loading,
          action: () => setApplyDialogOpen(true),
        };

  return (
    <div className="bg-white px-5 pb-28 pt-6 sm:bg-slate-100 sm:px-6">
      <section className="mx-auto max-w-[560px] bg-white sm:border sm:border-slate-200 sm:p-8 sm:shadow-sm">
        <header>
          <h1 className="whitespace-pre-line text-[28px] font-bold leading-[1.25] tracking-normal text-slate-950 sm:text-[32px]">
            1분만에 사업비 관리시트를 MYSCube에 연동하기
          </h1>
          <div className="mt-3 text-[13px] text-slate-500">
            현재 연동된 시트 이름 {linkedSheetName || '없음'}
          </div>
        </header>

        {hasSavedConfig && (
          <div className="mt-5 border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
            <div className="font-bold">연결된 시트</div>
            <div className="mt-1 text-[12px] text-blue-900">
              {savedConfig?.sheetName || '시트 탭'} · {savedConfig?.startWeek || '전체'} ~ {savedConfig?.endWeek || '전체'}
            </div>
            <div className="mt-1 break-all text-[11px] text-blue-800">
              {savedConfig?.spreadsheetTitle || savedConfig?.spreadsheetId || savedConfig?.value}
            </div>
          </div>
        )}

        <ol className="relative mt-10 space-y-8 before:absolute before:left-[17px] before:bottom-6 before:top-8 before:w-px before:bg-slate-200">
          {showSetupSteps && <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(1)}>1</span>
            <div className="min-w-0 space-y-3 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">아래 공유계정 확인을 누르고 공유계정 복사를 눌러서 시트에 엑세스 권한을 업데이트 해요</h2>
                <HelpMemo>시스템 계정이 Google Sheet를 읽을 수 있어야 시트 값과 MYSCube값을 비교할 수 있습니다. 보기 권한이면 충분합니다.</HelpMemo>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px] transition-transform hover:-translate-y-0.5"
                  disabled={!projectId || accountLoading}
                  onClick={() => void handleLoadShareAccount()}
                >
                  {accountLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                  공유 계정 확인
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px] transition-transform hover:-translate-y-0.5"
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
              <div className="text-[12px] text-slate-500">Google Sheet를 위 공유 계정에 보기 권한으로 공유한 뒤 바로 검토하세요.</div>
            </div>
          </li>}

          {showSetupSteps && <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(2)}>2</span>
            <div className="min-w-0 space-y-2 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">시트 링크와 탭이름을 입력해주세요. 탭 이름과 시작 및 종료 주차는 사업에 맞게 조정해주세요</h2>
                <HelpMemo>다음 방문 때 다시 입력하지 않도록 링크, 탭 이름, 주차 범위를 먼저 저장합니다. 이 단계는 금액 저장이 아닙니다.</HelpMemo>
              </div>
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
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px] transition-transform hover:-translate-y-0.5"
                  disabled={!canSaveConfig || isCurrentSheetConfigSaved}
                  onClick={() => void handleSaveSheetConfig()}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {isCurrentSheetConfigSaved ? '임시 저장됨' : '임시 저장'}
                </Button>
                <div className="text-[12px] text-slate-500">
                  링크, 탭 이름, 주차 범위만 저장합니다. 캐시플로우 값은 바뀌지 않습니다.
                </div>
              </div>
            </div>
          </li>}

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(3)}>{showSetupSteps ? 3 : 1}</span>
            <div className="min-w-0 space-y-3 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">시트에서 플랫폼에 저장할 값을 검토해주세요.</h2>
                <HelpMemo>Google Sheet 값을 읽고 저장 전에 MYSCube값과 비교할 준비를 합니다. 아직 MYSCube에는 아무 값도 쓰지 않습니다.</HelpMemo>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none px-4 text-[13px] transition-transform hover:-translate-y-0.5"
                disabled={!canPreview}
                onClick={() => void handlePreview()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                검토
              </Button>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(4)}>{showSetupSteps ? 4 : 2}</span>
            <div className="min-w-0 space-y-3 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">MYSCube에 값 저장</h2>
                <HelpMemo>버튼을 누르면 시트와 MYSCube값 차이를 확인한 뒤 팝업에서 저장합니다. Actual은 기존 값이 있어도 시트 값을 기준으로 덮어씁니다.</HelpMemo>
              </div>
              {stageResult ? (
                <div className="space-y-3">
                  <div className="text-[13px] font-semibold text-emerald-800">
                      비교 결과 {stageResult.stagedLineCount.toLocaleString()}건
                      {stageResult.stagedLineCount > 0 ? (
                        <>
                      {' · '}Projection {stageResult.projectionLineCount.toLocaleString()}건
                      {' · '}Actual {stageResult.actualLineCount.toLocaleString()}건
                      {stageResult.riskLineCount > 0 ? ` · 확인 필요 ${stageResult.riskLineCount.toLocaleString()}건` : ''}
                      {' · '}바로 저장 가능 {safeStageLineCount.toLocaleString()}건
                        </>
                      ) : null}
                  </div>
                  {reflectResult ? (
                    <div className="space-y-3">
                      <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                          저장 완료 · 실제 저장 {reflectResult.appliedLineCount.toLocaleString()}건
                          {' · '}Projection {reflectResult.projectionLineCount.toLocaleString()}건
                          {' · '}Actual {reflectResult.actualLineCount.toLocaleString()}건
                          {reflectResult.skippedRiskLineCount ? ` · 확인 필요 ${reflectResult.skippedRiskLineCount.toLocaleString()}건 남김` : ''}
                      </div>
                      <Button asChild variant="outline" className="h-9 rounded-none px-3 text-[12px]">
                        <Link to="/portal/cashflow">캐시플로우로 이동</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                          저장 팝업에서 최종 확인 후 MYSCube에 저장합니다.
                      </div>
                      <Button
                        type="button"
                        className="h-10 gap-1.5 rounded-none px-4 text-[13px] transition-transform hover:-translate-y-0.5"
                        disabled={!canReflect}
                        onClick={() => setApplyDialogOpen(true)}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {safeStageLineCount > 0 ? `검토한 값 ${safeStageLineCount.toLocaleString()}건 저장 확인` : '저장할 변경 없음'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  type="button"
                  className="h-10 gap-1.5 rounded-none px-4 text-[13px] transition-transform hover:-translate-y-0.5"
                  disabled={!canApply}
                  onClick={() => void handleStageSheetValues()}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  전체 MYSCube에 저장하기
                </Button>
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
        <section className="mx-auto mt-4 max-w-[560px] space-y-3 border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-emerald-800">시트 검토 완료</div>
              <div className="truncate text-[12px] font-medium text-slate-950">
                {preview.selectedSheetName}
              </div>
              <div className="text-[11px] text-slate-500">
                검토 범위 {totalBasisLabel}
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
        </section>
      )}
      <AlertDialog open={applyDialogOpen} onOpenChange={setApplyDialogOpen}>
        <AlertDialogContent className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[1280px] flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>전체 MYSCube에 저장할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              아래 주차별 차이를 확인한 뒤 저장합니다. Actual은 기존 값이 있어도 시트 값을 기준으로 덮어씁니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {stageResult && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 text-[13px] text-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-950">
                  저장 대상 {safeStageLineCount.toLocaleString()}건
                </div>
                <div className="text-slate-500">Projection {stageResult.projectionLineCount.toLocaleString()}건 · Actual {stageResult.actualLineCount.toLocaleString()}건</div>
              </div>
              {stageResult.riskLineCount > 0 && (
                <div className="border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  확인 필요 {stageResult.riskLineCount.toLocaleString()}건은 저장하지 않고 남깁니다.
                </div>
              )}
              {stageResult.omittedCandidateCount > 0 && (
                <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                  화면에는 일부만 표시했습니다. 추가 {stageResult.omittedCandidateCount.toLocaleString()}건도 같은 기준으로 저장됩니다.
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto border border-slate-200">
                <table className="w-full min-w-[860px] text-[12px]">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">주차</th>
                      <th className="px-3 py-2 text-left font-medium">구분</th>
                      <th className="px-3 py-2 text-left font-medium">항목</th>
                      <th className="px-3 py-2 text-left font-medium">저장 여부</th>
                      <th className="px-3 py-2 text-right font-medium">MYSCube값</th>
                      <th className="px-3 py-2 text-right font-medium">시트 값</th>
                      <th className="px-3 py-2 text-right font-medium">차이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageCandidates.map((candidate) => {
                      const diff = getCandidateDiff(candidate);
                      const riskFlags = candidate.riskFlags || [];
                      return (
                        <tr key={candidate.id || `${candidate.mode}-${candidate.yearMonth}-${candidate.weekNo}-${candidate.lineId}`} className="border-t border-slate-100">
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{formatCandidateWeek(candidate)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                            {candidate.mode === 'projection' ? 'Projection' : 'Actual'} · {candidate.lineDirection === 'in' ? '입금' : '출금'}
                          </td>
                          <td className="px-3 py-2 font-medium text-slate-900">{getCandidateLineLabel(candidate)}</td>
                          <td className="px-3 py-2">
                            {riskFlags.length ? (
                              <span className="inline-flex bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">
                                확인 필요 · {riskFlags.map(formatRiskFlag).join(', ')}
                              </span>
                            ) : (
                              <span className="inline-flex bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                                저장 대상
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                            {formatCandidateAmount(candidate.beforeAmount, candidate.beforeHadValue)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-950">
                            {formatCandidateAmount(candidate.proposedAmount, candidate.proposedHadValue)}
                          </td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                            {formatDiffAmount(diff)}
                          </td>
                        </tr>
                      );
                    })}
                    {stageCandidates.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                          MYSCube값과 다른 값이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>취소</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canReflect}
              onClick={(event) => {
                event.preventDefault();
                void handleReflectSheetValues();
              }}
            >
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              전체 MYSCube에 저장
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
