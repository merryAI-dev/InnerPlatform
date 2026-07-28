import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Copy, HelpCircle, Loader2, RefreshCw, Save, UserPlus } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../data/auth-store';
import { usePortalStore } from '../../data/portal-store';
import { useFirebase } from '../../lib/firebase-context';
import { getAuthInstance } from '../../lib/firebase';
import {
  extractSpreadsheetIdFromSheetInput,
  applyCashflowSheetLabViaBff,
  cashflowFormulaMismatchesFromError,
  getCashflowSheetLabApplyStatusViaBff,
  getCashflowSheetLabShareAccountViaBff,
  refreshCashflowSheetLabMirrorViaBff,
  saveCashflowSheetLabConfigViaBff,
  stageCashflowSheetLabViaBff,
  type CashflowSheetLabShareAccountResult,
  type CashflowSheetLabMirrorResult,
  type CashflowSheetLabStageResult,
  type CashflowFormulaMismatch,
} from '../../lib/sheets-cashflow-readonly-client';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
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
import { resolvePortalProjectResourcePath } from '../../platform/portal-project-selection';
import { resolveFinanceWeekForDate } from '../../platform/cashflow-weeks';
import { CashflowSheetSyncOverlay, type CashflowSheetSyncOperation } from '../../components/cashflow/CashflowSheetSyncOverlay';
import { CashflowFormulaMismatchDialog } from '../../components/cashflow/CashflowFormulaMismatchDialog';

function formatError(error: unknown) {
  const apiError = error as { body?: { code?: string; error?: string; message?: string }; requestId?: string; status?: number };
  const code = getErrorCode(error);
  if (code === 'google_sheets_not_configured') {
    return '서버의 Google Sheets 서비스 계정이 설정되지 않았습니다. 관리자에게 환경 변수 설정을 요청하세요.';
  }
  if (code === 'google_sheet_service_account_forbidden') {
    return '시트를 시스템 계정에 공유해 주세요. 공유 후 다시 연동하면 됩니다.';
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
  const apiError = error as { code?: string; body?: { code?: string; error?: string } };
  return apiError?.code || apiError?.body?.code || apiError?.body?.error || '';
}

function getClosedMonthDifferences(error: unknown) {
  const apiError = error as {
    body?: { details?: { closedMonthDifferences?: CashflowSheetLabStageResult['closedMonthDifferences'] } };
  };
  return apiError.body?.details?.closedMonthDifferences || [];
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

function CashflowSheetHeroAnimation() {
  const tiles = [
    { kind: 'excel', label: 'XLS', x: -112, y: -104, rotate: -16, size: 82, delay: 0 },
    { kind: 'cashflow', label: 'Cashflow', x: 80, y: -114, rotate: 14, size: 72, delay: 0.7 },
    { kind: 'mysc', label: 'MYSC', x: 120, y: -4, rotate: 16, size: 90, delay: 1.2 },
    { kind: 'plus', label: '입금', x: -120, y: 72, rotate: -20, size: 76, delay: 0.4 },
    { kind: 'minus', label: '출금', x: 78, y: 100, rotate: 11, size: 68, delay: 1.0 },
  ];

  return (
    <div className="select-none text-center">
      <div className="motion-safe:animate-[cashflow-hero-enter_0.45s_ease-out_both] text-[28px] font-black leading-tight text-slate-950 sm:text-[34px]">
        사업비 관리시트 연동
      </div>
      <div className="mt-2 motion-safe:animate-[cashflow-hero-fade_0.45s_ease-out_0.12s_both] text-[14px] leading-relaxed text-slate-500">
        사업비 관리시트를<br />필요할 때 가져와 MYSCube에 반영
      </div>
      <div className="relative mx-auto mt-12 h-[330px] w-[330px] motion-safe:animate-[cashflow-hero-scale_0.55s_ease-out_0.18s_both]">
        <div className="absolute left-1/2 top-1/2 flex h-[188px] w-[188px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-[#4f7cff] to-[#00c4a0] shadow-[0_24px_64px_rgba(79,124,255,0.42),0_6px_20px_rgba(15,23,42,0.16)] motion-safe:animate-[spin_6s_linear_infinite]">
          <svg width="76" height="76" viewBox="0 0 72 72" fill="none" aria-hidden="true">
            <path d="M14 36C14 23.85 23.85 14 36 14C44.5 14 51.9 18.7 55.6 25.6" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
            <path d="M55 20L56.5 26.5L50 26" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M58 36C58 48.15 48.15 58 36 58C27.5 58 20.1 53.3 16.4 46.4" stroke="white" strokeWidth="5.5" strokeLinecap="round" />
            <path d="M17 52L15.5 45.5L22 46" stroke="white" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="absolute flex items-center justify-center overflow-hidden bg-gradient-to-br from-white to-slate-100 shadow-[0_1px_0_rgba(255,255,255,1)_inset,0_-1px_0_rgba(0,0,0,0.06)_inset,6px_14px_36px_rgba(15,23,42,0.18),0_2px_6px_rgba(15,23,42,0.10)] motion-safe:animate-[cashflow-tile-float_3.2s_ease-in-out_infinite]"
            style={{
              left: `calc(50% + ${tile.x}px)`,
              top: `calc(50% + ${tile.y}px)`,
              width: tile.size,
              height: tile.size,
              borderRadius: tile.size * 0.27,
              transform: `translate(-50%, -50%) rotate(${tile.rotate}deg)`,
              animationDelay: `${tile.delay}s`,
            }}
          >
            {tile.kind === 'excel' && (
              <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
                <rect width="52" height="52" rx="10" fill="#1D6F42" />
                <text x="10" y="38" fill="white" fontSize="28" fontWeight="800" fontFamily="Arial, sans-serif">X</text>
              </svg>
            )}
            {tile.kind === 'cashflow' && (
              <div className="flex flex-col items-center gap-1">
                <svg width="28" height="20" viewBox="0 0 28 20" fill="none" aria-hidden="true">
                  <path d="M7 15L7 5M7 5L3 9M7 5L11 9" stroke="#4f7cff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M21 5L21 15M21 15L17 11M21 15L25 11" stroke="#00c4a0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="bg-gradient-to-r from-[#4f7cff] to-[#00c4a0] bg-clip-text text-[10px] font-extrabold text-transparent">Cashflow</span>
              </div>
            )}
            {tile.kind === 'mysc' && (
              <span className="text-[18px] font-black lowercase tracking-[-0.02em] text-[#001e46]">mysc</span>
            )}
            {tile.kind === 'plus' && (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[42px] font-black leading-none text-[#4f7cff]">+</span>
                <span className="text-[9px] font-bold text-[#4f7cff]">입금</span>
              </div>
            )}
            {tile.kind === 'minus' && (
              <div className="flex flex-col items-center gap-1">
                <span className="text-[42px] font-black leading-none text-[#00c4a0]">-</span>
                <span className="text-[9px] font-bold text-[#00c4a0]">출금</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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
  sourceYear,
  value,
  sheetName,
  startWeek,
  endWeek,
}: {
  projectId: string;
  sourceYear: number;
  value: string;
  sheetName: string;
  startWeek: string;
  endWeek: string;
}) {
  return JSON.stringify({
    projectId: projectId.trim(),
    sourceYear,
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

function formatClosedMonthDifference(summary: NonNullable<CashflowSheetLabStageResult['closedMonthDifferences']>[number]) {
  const visibleWeeks = summary.weeks.slice(0, 2).map((week) => `${week}주차`).join(', ');
  const hiddenWeekCount = Math.max(0, summary.weeks.length - 2);
  return `${summary.yearMonth} · ${visibleWeeks}${hiddenWeekCount > 0 ? ` 외 ${hiddenWeekCount}개 주차` : ''}`;
}

export function CashflowSheetLabPage({
  projectIdOverride,
}: {
  projectIdOverride?: string;
} = {}) {
  const { user: authUser, loginWithGoogle } = useAuth();
  const { activeProjectId, myProject } = usePortalStore();
  const { orgId } = useFirebase();
  const { projectId: routeProjectIdParam } = useParams<{ projectId: string }>();
  const routeProjectId = routeProjectIdParam?.trim() || '';
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const portalProjectId = activeProjectId || myProject?.id || '';
  const initialProjectId = useMemo(() => (
    routeProjectId
    || projectIdOverride?.trim()
    || searchParams.get('projectId')?.trim()
    || portalProjectId
    || authUser?.projectId
    || authUser?.projectIds?.[0]
    || readRecentPortalProjectIds()[0]
    || ''
  ), [authUser?.projectId, authUser?.projectIds, portalProjectId, projectIdOverride, routeProjectId, searchParams]);
  const [projectIdInput, setProjectIdInput] = useState(initialProjectId);
  const projectYears = useMemo(() => {
    const startYear = /^\d{4}-/.test(myProject?.contractStart || '') ? Number(myProject?.contractStart.slice(0, 4)) : Number.NaN;
    const endYear = /^\d{4}-/.test(myProject?.contractEnd || '') ? Number(myProject?.contractEnd.slice(0, 4)) : Number.NaN;
    if (Number.isSafeInteger(startYear) && Number.isSafeInteger(endYear) && startYear <= endYear) {
      return Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    }
    const financialYears = (myProject?.financialYears || []).map((row) => row.year).filter(Number.isSafeInteger);
    return financialYears.length > 0 ? financialYears : [2026];
  }, [myProject?.contractEnd, myProject?.contractStart, myProject?.financialYears]);
  const projectWeekRange = useCallback((year: number) => {
    const firstYear = projectYears[0];
    const lastYear = projectYears.at(-1);
    const startDate = year === firstYear && myProject?.contractStart ? myProject.contractStart : `${year}-01-01`;
    const endDate = year === lastYear && myProject?.contractEnd ? myProject.contractEnd : `${year}-12-31`;
    return {
      startWeek: resolveFinanceWeekForDate(startDate)?.label || `${String(year).slice(2)}-1-1`,
      endWeek: resolveFinanceWeekForDate(endDate)?.label || `${String(year).slice(2)}-12-5`,
    };
  }, [myProject?.contractEnd, myProject?.contractStart, projectYears]);
  const [sourceYear, setSourceYear] = useState(() => (
    projectYears.includes(2026) ? 2026 : projectYears[0] || 2026
  ));
  const [sheetLink, setSheetLink] = useState('');
  const [sheetName, setSheetName] = useState('cashflow(사용내역 연동)');
  const [startWeek, setStartWeek] = useState('');
  const [endWeek, setEndWeek] = useState('');
  const [mirror, setMirror] = useState<CashflowSheetLabMirrorResult | null>(null);
  const [reviewedSourceKey, setReviewedSourceKey] = useState('');
  const [savedConfig, setSavedConfig] = useState<CashflowSheetLabShareAccountResult['config']>(null);
  const [savedConfigs, setSavedConfigs] = useState<NonNullable<CashflowSheetLabShareAccountResult['config']>[]>([]);
  const [systemAccountEmail, setSystemAccountEmail] = useState('');
  const [reflectResult, setReflectResult] = useState<{
    appliedLineCount: number;
    projectionLineCount: number;
    actualLineCount: number;
    skippedRiskLineCount?: number;
    lastAppliedAt?: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [closedMonthWarning, setClosedMonthWarning] = useState<NonNullable<CashflowSheetLabStageResult['closedMonthDifferences']>>([]);
  const [closedMonthStage, setClosedMonthStage] = useState<CashflowSheetLabStageResult | null>(null);
  const [applyResumeRequired, setApplyResumeRequired] = useState(false);
  const [closedMonthChangeReason, setClosedMonthChangeReason] = useState('');
  const [closedMonthFormulaAccepted, setClosedMonthFormulaAccepted] = useState(false);
  const [formulaMismatchPrompt, setFormulaMismatchPrompt] = useState<{
    stage: CashflowSheetLabStageResult;
    issues: CashflowFormulaMismatch[];
    closedMonthChangeReason: string;
  } | null>(null);
  const [loadingOperation, setLoadingOperation] = useState<CashflowSheetSyncOperation | null>(null);
  const loading = loadingOperation !== null;
  const [accountLoading, setAccountLoading] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialSlide, setTutorialSlide] = useState(0);
  const sheetLinkRef = useRef<HTMLInputElement>(null);
  const saveConfigButtonRef = useRef<HTMLButtonElement>(null);
  const configLoadGenerationRef = useRef(0);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const stageButtonRef = useRef<HTMLButtonElement>(null);
  const projectId = projectIdInput.trim();
  const tutorialStorageKey = projectId ? `cashflow-sheet-tutorial:${projectId}` : '';
  const currentPath = `${location.pathname}${location.search}${location.hash}`;
  const spreadsheetId = useMemo(() => extractSpreadsheetIdFromSheetInput(sheetLink), [sheetLink]);
  const hasSheetDraft = Boolean(sheetLink.trim() || sheetName.trim() || startWeek.trim() || endWeek.trim());
  const sourceKey = useMemo(() => buildSourceKey({
    projectId,
    sourceYear,
    value: sheetLink,
    sheetName,
    startWeek,
    endWeek,
  }), [endWeek, projectId, sheetLink, sheetName, sourceYear, startWeek]);
  const detectedYearModes = useMemo(() => (mirror?.sheetFacts?.annualCashflowTotals || []).map((row) => {
    const sources = new Set([row.projection.source, row.actual.source]);
    const valueCellCount = row.projection.valueCellCount + row.actual.valueCellCount;
    return {
      year: row.year,
      mode: valueCellCount === 0 ? '값 없음' : sources.has('WEEKLY') ? '주차별 값' : sources.has('ANNUAL') ? '연간 합계' : '값 없음',
    };
  }), [mirror?.sheetFacts?.annualCashflowTotals]);
  const savedConfigSourceKey = useMemo(() => (
    savedConfig?.value
      ? buildSourceKey({
          projectId,
          sourceYear,
          value: savedConfig.value,
          sheetName: savedConfig.sheetName || '',
          startWeek: savedConfig.startWeek || '',
          endWeek: savedConfig.endWeek || '',
        })
      : ''
  ), [projectId, savedConfig, sourceYear]);
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
    if (!routeProjectId || routeProjectId === projectIdInput) return;
    setProjectIdInput(routeProjectId);
  }, [projectIdInput, routeProjectId]);

  useEffect(() => {
    if (routeProjectId) return;
    const nextProjectId = projectIdOverride?.trim();
    if (!nextProjectId || nextProjectId === projectIdInput) return;
    setProjectIdInput(nextProjectId);
  }, [projectIdInput, projectIdOverride, routeProjectId]);

  useEffect(() => {
    if (projectIdInput || !portalProjectId) return;
    setProjectIdInput(portalProjectId);
  }, [portalProjectId, projectIdInput]);

  useEffect(() => {
    if (!projectId) return;
    rememberRecentPortalProject(projectId);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !actor.idToken) return () => { cancelled = true; };
    const loadApplyStatus = async (): Promise<void> => {
      try {
        const result = await runWithBffAuthRetry('apply.status', (requestActor) => (
          getCashflowSheetLabApplyStatusViaBff({
            tenantId: orgId,
            actor: requestActor,
            projectId,
          })
        ));
        if (cancelled || result?.status !== 'APPLYING' || !result.stagedRun) return;
        setClosedMonthStage(result.stagedRun);
        setClosedMonthWarning(result.stagedRun.closedMonthDifferences || []);
        setClosedMonthChangeReason(result.applyInput?.closedMonthChangeReason || '');
        setClosedMonthFormulaAccepted(result.applyInput?.acceptFormulaMismatches === true);
        setApplyResumeRequired(true);
        setErrorMessage('이전에 완료 응답을 받지 못한 시트 반영이 있습니다. 같은 검토본으로 이어서 완료해 주세요.');
      } catch {
        // 복구 상태 조회 실패는 시트 설정 화면 진입 자체를 막지 않는다.
      }
    };
    void loadApplyStatus();
    return () => {
      cancelled = true;
    };
  }, [actor.idToken, orgId, projectId]);

  useEffect(() => {
    if (projectYears.includes(sourceYear)) return;
    setSourceYear(projectYears[0] || 2026);
  }, [projectYears, sourceYear]);

  useEffect(() => {
    if (savedConfig?.sourceYear === sourceYear || startWeek || endWeek) return;
    const range = projectWeekRange(sourceYear);
    setStartWeek(range.startWeek);
    setEndWeek(range.endWeek);
  }, [endWeek, projectWeekRange, savedConfig?.sourceYear, sourceYear, startWeek]);

  useEffect(() => {
    if (routeProjectId || !projectId) return;
    navigate(resolvePortalProjectResourcePath(currentPath, projectId), { replace: true });
  }, [currentPath, navigate, projectId, routeProjectId]);

  useEffect(() => {
    if (!tutorialStorageKey) return;
    try {
      if (sessionStorage.getItem(tutorialStorageKey) === 'seen') return;
    } catch {
      // Storage가 차단돼도 가이드 자체는 사용할 수 있어야 한다.
    }
    setTutorialSlide(0);
    setTutorialOpen(true);
  }, [tutorialStorageKey]);

  const markTutorialSeen = useCallback(() => {
    if (!tutorialStorageKey) return;
    try {
      sessionStorage.setItem(tutorialStorageKey, 'seen');
    } catch {
      // Private browsing 등 저장소 제한은 사용자 흐름을 막지 않는다.
    }
  }, [tutorialStorageKey]);

  function handleTutorialOpenChange(open: boolean) {
    setTutorialOpen(open);
    if (!open) markTutorialSeen();
  }

  function openTutorial() {
    setTutorialSlide(0);
    setTutorialOpen(true);
  }

  function handleSourceYearChange(nextYear: number) {
    const nextConfig = savedConfigs.find((config) => config.sourceYear === nextYear) || null;
    const range = projectWeekRange(nextYear);
    setSourceYear(nextYear);
    setSavedConfig(nextConfig);
    setSheetLink(nextConfig?.value || '');
    setSheetName(nextConfig?.sheetName || 'cashflow(사용내역 연동)');
    setStartWeek(nextConfig?.startWeek || range.startWeek);
    setEndWeek(nextConfig?.endWeek || range.endWeek);
    setReviewedSourceKey('');
    setReflectResult(null);
    setStatusMessage('');
    setErrorMessage('');
  }

  async function handleLoadShareAccount({ forceHydrate = false } = {}) {
    if (!projectId) return;
    const requestedProjectId = projectId;
    const requestedSourceYear = sourceYear;
    const generation = ++configLoadGenerationRef.current;
    setAccountLoading(true);
    setStatusMessage('');
    try {
      const result = await runWithBffAuthRetry('share_account.load', (requestActor) => (
        getCashflowSheetLabShareAccountViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId: requestedProjectId,
          sourceYear: requestedSourceYear,
        })
      ));
      if (!result || generation !== configLoadGenerationRef.current) return;
      const email = result.systemAccountEmail || result.accessPolicy?.serviceAccountEmail || '';
      if (!email) {
        setErrorMessage('서버의 Google Sheets 서비스 계정 이메일을 확인하지 못했습니다.');
        return;
      }
      setSystemAccountEmail(email);
      const configs = Array.isArray(result.configs) ? result.configs : [];
      const scopedConfig = configs.find((config) => config.sourceYear === requestedSourceYear)
        || (result.config?.sourceYear === requestedSourceYear ? result.config : null);
      setSavedConfig(scopedConfig);
      setSavedConfigs(configs);
      if (scopedConfig?.value && (forceHydrate || !hasSheetDraft || scopedConfig.sourceYear !== savedConfig?.sourceYear)) {
        setSheetLink(scopedConfig.value);
        setSheetName(scopedConfig.sheetName || 'cashflow(사용내역 연동)');
        setStartWeek(scopedConfig.startWeek || '');
        setEndWeek(scopedConfig.endWeek || '');
      }
      if (!scopedConfig?.value) setStatusMessage('공유 계정을 확인했습니다.');
      logCashflowLab('share_account.load.ok', {
        projectId,
        hasSystemAccountEmail: true,
      });
    } catch (error) {
      logCashflowLab('share_account.load.error', { projectId, ...errorDiagnostics(error) }, 'warn');
      if (generation === configLoadGenerationRef.current) setErrorMessage(formatError(error));
    } finally {
      if (generation === configLoadGenerationRef.current) setAccountLoading(false);
    }
  }

  useEffect(() => {
    if (!projectId || !actor.idToken) return;
    configLoadGenerationRef.current += 1;
    const range = projectWeekRange(sourceYear);
    setSavedConfig(null);
    setSavedConfigs([]);
    setSheetLink('');
    setSheetName('cashflow(사용내역 연동)');
    setStartWeek(range.startWeek);
    setEndWeek(range.endWeek);
    setMirror(null);
    setReviewedSourceKey('');
    setReflectResult(null);
    setStatusMessage('');
    setErrorMessage('');
    void handleLoadShareAccount({ forceHydrate: true });
  }, [actor.idToken, projectId, sourceYear]);

  function handleCopyShareAccount() {
    if (!systemAccountEmail) return;
    void navigator.clipboard?.writeText(systemAccountEmail).catch(() => undefined);
    setStatusMessage('공유 계정을 복사했습니다.');
    logCashflowLab('share_account.copy', { projectId, hasSystemAccountEmail: true });
  }

  async function handleSaveSheetConfig() {
    if (!projectId || loading || !spreadsheetId) return;
    setLoadingOperation('saving');
    setErrorMessage('');
    setStatusMessage('');
    setReviewedSourceKey('');
    setReflectResult(null);
    try {
      const result = await runWithBffAuthRetry('settings.save', (requestActor) => (
        saveCashflowSheetLabConfigViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          sourceYear,
          value: sheetLink,
          sheetName: sheetName || undefined,
          startWeek: startWeek || undefined,
          endWeek: endWeek || undefined,
        })
      ));
      if (!result) return;
      setSavedConfig(result.config || null);
      setSavedConfigs(result.configs || []);
      setStatusMessage('시트 정보를 저장했습니다. 금액은 아직 MYSCube에 반영되지 않았습니다.');
      logCashflowLab('settings.save.ok', { projectId, spreadsheetId, sheetName: sheetName || null });
    } catch (error) {
      logCashflowLab('settings.save.error', { projectId, spreadsheetId, ...errorDiagnostics(error) }, 'warn');
      setErrorMessage(formatError(error));
    } finally {
      setLoadingOperation(null);
    }
  }
  async function handleRefreshSheetMirror() {
    if (!projectId || loading || !spreadsheetId) return;
    const startedAt = Date.now();
    const refreshIdempotencyKey = `cashflow-sheet-lab-refresh:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    setLoadingOperation('refresh');
    setErrorMessage('');
    setStatusMessage('');
    setReviewedSourceKey('');
    setReflectResult(null);
    try {
      logCashflowLab('mirror.refresh.start', {
        projectId,
        spreadsheetId,
        sheetName: sheetName || null,
      });
      const result = await runWithBffAuthRetry('mirror.refresh', (requestActor) => (
        refreshCashflowSheetLabMirrorViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          sourceYear,
          value: sheetLink,
          sheetName: sheetName || undefined,
          startWeek: startWeek || undefined,
          endWeek: endWeek || undefined,
          idempotencyKey: refreshIdempotencyKey,
        })
      ));
      if (!result) return;
      const nextSheetName = sheetName || result.selectedSheetName || '';
      setMirror((current) => result.status === 'STALE' && current?.sourceRevision
        ? {
            ...current,
            ...result,
            sourceRevision: result.sourceRevision || current.sourceRevision,
            capturedAt: result.capturedAt || current.capturedAt,
            summary: result.summary || current.summary,
            cells: result.cells || current.cells,
          }
        : result);
      setReviewedSourceKey(result.status === 'FRESH' && result.sourceRevision
        ? buildSourceKey({ projectId, sourceYear, value: sheetLink, sheetName: nextSheetName, startWeek, endWeek })
        : '');
      if (result.status === 'FRESH' && result.sourceRevision) {
        setStatusMessage('시트 최신값을 고정했습니다. 시트 값으로 덮어쓸 수 있습니다.');
      } else if (result.status === 'STALE') {
        setStatusMessage('');
      } else {
        setErrorMessage(result.lastRefreshError?.message || '시트 연동에 실패했습니다.');
      }
      logCashflowLab('mirror.refresh.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.selectedSheetName,
        mirrorStatus: result.status,
        sourceRevision: result.sourceRevision,
        cellCount: result.summary?.cellCount || 0,
        durationMs: Date.now() - startedAt,
      });
      if (!sheetName && result.selectedSheetName) setSheetName(result.selectedSheetName);
    } catch (error) {
      logCashflowLab('mirror.refresh.error', {
        projectId,
        spreadsheetId,
        durationMs: Date.now() - startedAt,
        ...errorDiagnostics(error),
      }, 'warn');
      setErrorMessage(formatError(error));
      if (getErrorCode(error) === 'google_sheet_service_account_forbidden') {
        void handleLoadShareAccount();
      }
    } finally {
      setLoadingOperation(null);
    }
  }

  async function handleOverwriteSheetValues(
    monthCloseChangeReason = '',
    stagedOverride: CashflowSheetLabStageResult | null = null,
    acceptFormulaMismatches = false,
  ) {
    if (
      !projectId
      || loading
      || !spreadsheetId
      || (!stagedOverride && (mirror?.status !== 'FRESH' || !mirror.sourceRevision || reviewedSourceKey !== sourceKey))
    ) return;
    const startedAt = Date.now();
    const expectedMirrorRevision = mirror?.sourceRevision || '';
    const stageIdempotencyKey = `cashflow-sheet-lab-stage:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const applyIdempotencyKey = `cashflow-sheet-lab-apply:${projectId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    let activeStep: 'stage' | 'apply' = stagedOverride ? 'apply' : 'stage';
    let staged = stagedOverride;
    let stageDurationMs = 0;
    setLoadingOperation(stagedOverride ? 'applying' : 'staging');
    setErrorMessage('');
    setStatusMessage('');
    if (!stagedOverride) {
      setClosedMonthWarning([]);
      setClosedMonthStage(null);
      setClosedMonthChangeReason('');
    }
    setReflectResult(null);
    logCashflowLab('overwrite.sheet_values.start', {
      projectId,
      spreadsheetId,
    });
    try {
      if (!staged) {
        logCashflowLab('stage.sheet_values.start', { projectId, spreadsheetId });
        const stageStartedAt = Date.now();
        staged = await runWithBffAuthRetry('stage.sheet_values', (requestActor) => (
          stageCashflowSheetLabViaBff({
            tenantId: orgId,
            actor: requestActor,
            projectId,
            expectedMirrorRevision,
            idempotencyKey: stageIdempotencyKey,
          })
        ));
        stageDurationMs = Date.now() - stageStartedAt;
      }
      if (!staged) {
        logCashflowLab('overwrite.sheet_values.cancelled', {
          projectId,
          spreadsheetId,
          step: activeStep,
          durationMs: Date.now() - startedAt,
        }, 'warn');
        return;
      }
      if (!stagedOverride) {
        setReviewedSourceKey(sourceKey);
        logCashflowLab('stage.sheet_values.ok', {
          projectId,
          spreadsheetId: staged.spreadsheetId,
          sheetName: staged.selectedSheetName,
          stagedLineCount: staged.stagedLineCount,
          projectionLineCount: staged.projectionLineCount,
          actualLineCount: staged.actualLineCount,
          riskLineCount: staged.riskLineCount,
          durationMs: stageDurationMs,
          totalDurationMs: Date.now() - startedAt,
        });
      }
      if (staged.status === 'BLOCKED') {
        logCashflowLab('overwrite.sheet_values.blocked', {
          projectId,
          spreadsheetId,
          riskLineCount: staged.riskLineCount,
          durationMs: Date.now() - startedAt,
        }, 'warn');
        const blockedMonths = staged.blockedMonths?.join(', ');
        setErrorMessage(`반영할 수 없는 시트 범위가 있습니다.${blockedMonths ? ` 확인할 월: ${blockedMonths}` : ''}`);
        return;
      }
      if (staged.stagedLineCount === 0) {
        setReflectResult({ appliedLineCount: 0, projectionLineCount: 0, actualLineCount: 0 });
        setStatusMessage('MYSCube가 이미 시트 최신값과 같습니다.');
        logCashflowLab('overwrite.sheet_values.noop', {
          projectId,
          spreadsheetId,
          durationMs: Date.now() - startedAt,
          stageDurationMs,
        });
        return;
      }
      activeStep = 'apply';
      setLoadingOperation('applying');
      const applyStartedAt = Date.now();
      const stagedRunId = staged.runId;
      logCashflowLab('apply.sheet_values.start', {
        projectId,
        spreadsheetId,
        stageRunId: staged.runId,
        stagedLineCount: staged.stagedLineCount,
        elapsedMs: applyStartedAt - startedAt,
      });
      const result = await runWithBffAuthRetry('apply.sheet_values', (requestActor) => (
        applyCashflowSheetLabViaBff({
          tenantId: orgId,
          actor: requestActor,
          projectId,
          stageRunId: stagedRunId,
          closedMonthChangeReason: monthCloseChangeReason,
          acceptFormulaMismatches,
          idempotencyKey: applyIdempotencyKey,
        })
      ));
      if (!result) {
        logCashflowLab('overwrite.sheet_values.cancelled', {
          projectId,
          spreadsheetId,
          step: activeStep,
          durationMs: Date.now() - startedAt,
          stageDurationMs,
        }, 'warn');
        return;
      }
      const applyDurationMs = Date.now() - applyStartedAt;
      const totalDurationMs = Date.now() - startedAt;
      setReflectResult({
        appliedLineCount: result.appliedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        skippedRiskLineCount: result.skippedRiskLineCount,
        lastAppliedAt: result.lastAppliedAt,
      });
      setClosedMonthStage(null);
      setApplyResumeRequired(false);
      setClosedMonthWarning([]);
      setClosedMonthChangeReason('');
      setClosedMonthFormulaAccepted(false);
      setFormulaMismatchPrompt(null);
      setStatusMessage(`시트 값 ${result.appliedLineCount.toLocaleString()}건으로 MYSCube를 덮어썼습니다.`);
      logCashflowLab('apply.sheet_values.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        sheetName: result.selectedSheetName,
        appliedLineCount: result.appliedLineCount,
        projectionLineCount: result.projectionLineCount,
        actualLineCount: result.actualLineCount,
        durationMs: applyDurationMs,
        totalDurationMs,
        stageDurationMs,
      });
      logCashflowLab('overwrite.sheet_values.ok', {
        projectId,
        spreadsheetId: result.spreadsheetId,
        appliedLineCount: result.appliedLineCount,
        durationMs: totalDurationMs,
        totalDurationMs,
        stageDurationMs,
        applyDurationMs,
      });
    } catch (error) {
      logCashflowLab('overwrite.sheet_values.error', {
        projectId,
        spreadsheetId,
        step: activeStep,
        durationMs: Date.now() - startedAt,
        totalDurationMs: Date.now() - startedAt,
        ...errorDiagnostics(error),
      }, 'warn');
      if (activeStep === 'apply' && getErrorCode(error) === 'cashflow_formula_mismatch_confirmation_required' && staged) {
        const issues = cashflowFormulaMismatchesFromError(error);
        if (issues.length > 0) {
          setFormulaMismatchPrompt({
            stage: staged,
            issues,
            closedMonthChangeReason: monthCloseChangeReason,
          });
          return;
        }
      }
      if (activeStep === 'apply' && getErrorCode(error) === 'cashflow_closed_month_reason_required') {
        const serverDifferences = getClosedMonthDifferences(error);
        setClosedMonthStage(staged);
        setClosedMonthWarning(
          serverDifferences.length
            ? serverDifferences
            : staged?.closedMonthDifferences || [],
        );
        setApplyResumeRequired(false);
        setClosedMonthFormulaAccepted(acceptFormulaMismatches);
      } else if (activeStep === 'apply' && staged) {
        setClosedMonthStage(staged);
        setClosedMonthChangeReason(stagedOverride ? monthCloseChangeReason.trim() : '');
        setClosedMonthFormulaAccepted(acceptFormulaMismatches);
        setApplyResumeRequired(true);
        setErrorMessage(`${formatError(error)} 같은 검토본으로 이어서 완료할 수 있습니다.`);
      } else {
        setErrorMessage(formatError(error));
      }
    } finally {
      setLoadingOperation(null);
    }
  }

  const isCurrentSheetConfigSaved = Boolean(savedConfigSourceKey && savedConfigSourceKey === sourceKey);
  const canRefresh = Boolean(projectId && spreadsheetId && isCurrentSheetConfigSaved && !loading);
  const canSaveConfig = Boolean(projectId && spreadsheetId && !loading);
  const hasCurrentFreshMirror = Boolean(mirror?.status === 'FRESH' && mirror.sourceRevision && reviewedSourceKey === sourceKey);
  const canOverwrite = Boolean(projectId && spreadsheetId && hasCurrentFreshMirror && !reflectResult && !loading);
  const hasSavedConfig = Boolean(savedConfig?.value);
  const currentStep = reflectResult || hasCurrentFreshMirror ? 3 : isCurrentSheetConfigSaved ? 2 : 1;
  const stepNumberClass = (step: number) =>
    `z-10 flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-bold ${
      step <= currentStep
        ? 'bg-[#001e46] text-white shadow-[0_0_0_4px_rgba(0,30,70,0.08)]'
        : 'bg-slate-100 text-slate-500'
    }`;

  function finishTutorial() {
    markTutorialSeen();
    setTutorialOpen(false);
    window.setTimeout(() => {
      const target = currentStep === 1
        ? (spreadsheetId ? saveConfigButtonRef.current : sheetLinkRef.current)
        : currentStep === 2
          ? refreshButtonRef.current
          : stageButtonRef.current;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }, 150);
  }

  return (
    <>
    <div className="bg-white px-5 py-6 sm:bg-slate-100 sm:px-6" inert={loading || undefined} aria-busy={loading}>
      <section className="mx-auto max-w-[560px] bg-white sm:border sm:border-slate-200 sm:p-8 sm:shadow-sm">
        <header>
          <CashflowSheetHeroAnimation />
          <div className="mt-2 flex justify-center">
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2 rounded-full border-blue-200 bg-blue-50 px-4 text-[12px] font-semibold text-blue-900 shadow-none hover:bg-blue-100"
              onClick={openTutorial}
            >
              <BookOpen className="h-4 w-4" />
              시트 연동 가이드
            </Button>
          </div>
        </header>

        <ol className="relative mt-10 space-y-8 before:absolute before:left-[17px] before:bottom-6 before:top-8 before:w-px before:bg-slate-200">
          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(1)}>1</span>
            <div className="min-w-0 space-y-2 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">시트 연결</h2>
                <HelpMemo>사업기간의 연도마다 해당 연도 주차 시트를 연결합니다. 이 단계에서는 금액을 저장하지 않습니다.</HelpMemo>
              </div>
              <label className="block text-[12px] font-semibold text-slate-700">
                연동 연도
                <select
                  value={sourceYear}
                  onChange={(event) => handleSourceYearChange(Number(event.target.value))}
                  className="mt-1 h-10 w-full rounded-none border border-slate-300 bg-white px-3 text-[13px] text-slate-900"
                  aria-label="연동 연도"
                >
                  {projectYears.map((year) => (
                    <option key={year} value={year}>
                      {year}년{savedConfigs.some((config) => config.sourceYear === year) ? ' · 연결됨' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                ref={sheetLinkRef}
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
                  ref={saveConfigButtonRef}
                  type="button"
                  variant={isCurrentSheetConfigSaved ? 'outline' : 'default'}
                  className="h-9 gap-1.5 rounded-none px-3 text-[12px] transition-transform hover:-translate-y-0.5"
                  disabled={!canSaveConfig || isCurrentSheetConfigSaved}
                  onClick={() => void handleSaveSheetConfig()}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {isCurrentSheetConfigSaved ? '저장됨' : '시트 정보 저장'}
                </Button>
                <div className="text-[12px] text-slate-500">
                  {sourceYear}년 링크와 {String(sourceYear).slice(2)}-1-1 ~ {String(sourceYear).slice(2)}-12-5 범위를 입력하세요.
                </div>
              </div>
              <details className="pt-2 text-[12px] text-slate-600">
                <summary className="cursor-pointer font-medium text-slate-700">시트 접근 권한이 필요한가요?</summary>
                <div className="mt-3 space-y-2 border-l-2 border-blue-200 pl-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-8 gap-1.5 rounded-none px-3 text-[12px]" disabled={!projectId || accountLoading} onClick={() => void handleLoadShareAccount()}>
                      {accountLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                      공유 계정 확인
                    </Button>
                    <Button type="button" variant="outline" className="h-8 gap-1.5 rounded-none px-3 text-[12px]" disabled={!systemAccountEmail} onClick={handleCopyShareAccount}>
                      <Copy className="h-3.5 w-3.5" />공유 계정 복사
                    </Button>
                  </div>
                  {systemAccountEmail && <div className="break-all bg-blue-50 px-3 py-2 font-mono text-blue-900">{systemAccountEmail}</div>}
                  <p>시트에 위 계정을 보기 권한으로 추가하면 됩니다.</p>
                </div>
              </details>
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(2)}>2</span>
            <div className="min-w-0 space-y-3 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">시트 값 가져오기</h2>
                <HelpMemo>저장한 설정으로 Google Sheet 최신값을 읽어 서버 고정본으로 만듭니다. 아직 MYSCube에는 저장하지 않습니다.</HelpMemo>
              </div>
              <Button
                ref={refreshButtonRef}
                type="button"
                variant="outline"
                className="h-10 gap-1.5 rounded-none px-4 text-[13px]"
                disabled={!canRefresh}
                onClick={() => void handleRefreshSheetMirror()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {mirror?.sourceRevision ? '시트 값 다시 가져오기' : '시트 값 가져오기'}
              </Button>
              {mirror?.lastRefreshError?.message ? (
                <div className="border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-900">
                  <span className="font-bold">시트 연동 오류</span> · {mirror.lastRefreshError.message}
                  {mirror.lastRefreshError.diagnostics?.length ? (
                    <ul className="mt-2 space-y-1 border-t border-red-200 pt-2">
                      {mirror.lastRefreshError.diagnostics.map((diagnostic, index) => (
                        <li key={`${diagnostic.code}-${diagnostic.sourceCell || index}`}>
                          {diagnostic.sourceCell ? `${diagnostic.sourceCell} · ` : ''}{diagnostic.message}
                          <span className="ml-1 text-red-700">({diagnostic.code})</span>
                        </li>
                      ))}
                      {(mirror.lastRefreshError.diagnosticCount || 0) > mirror.lastRefreshError.diagnostics.length ? (
                        <li>외 {(mirror.lastRefreshError.diagnosticCount || 0) - mirror.lastRefreshError.diagnostics.length}건</li>
                      ) : null}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>

          <li className="relative grid grid-cols-[36px_minmax(0,1fr)] gap-4">
            <span className={stepNumberClass(3)}>3</span>
            <div className="min-w-0 space-y-3 pb-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-[19px] font-bold text-slate-950">시트 값으로 덮어쓰기</h2>
                <HelpMemo>고정한 시트의 Projection과 Actual로 MYSCube 값을 덮어씁니다. 별도 운영자 검토는 없으며, 월 결산된 기간만 보호됩니다.</HelpMemo>
              </div>
              {reflectResult ? (
                <div className="space-y-3">
                  <div className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
                    {reflectResult.appliedLineCount > 0 ? (
                      <>
                        덮어쓰기 완료 · {reflectResult.appliedLineCount.toLocaleString()}건
                        {' · '}Projection {reflectResult.projectionLineCount.toLocaleString()}건
                        {' · '}Actual {reflectResult.actualLineCount.toLocaleString()}건
                      </>
                    ) : '이미 시트 최신값과 같습니다.'}
                  </div>
                  <Button asChild variant="outline" className="h-9 rounded-none px-3 text-[12px]">
                    <Link to={resolvePortalProjectResourcePath('/portal/cashflow', projectId)}>캐시플로우로 이동</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    ref={stageButtonRef}
                    type="button"
                    className="h-10 gap-1.5 rounded-none px-4 text-[13px]"
                    disabled={!canOverwrite}
                    onClick={() => void handleOverwriteSheetValues()}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    시트 값으로 덮어쓰기
                  </Button>
                </div>
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

      <CashflowFormulaMismatchDialog
        issues={formulaMismatchPrompt?.issues || []}
        busy={loading}
        onCancel={() => setFormulaMismatchPrompt(null)}
        onConfirm={() => {
          if (!formulaMismatchPrompt) return;
          const pending = formulaMismatchPrompt;
          setFormulaMismatchPrompt(null);
          void handleOverwriteSheetValues(pending.closedMonthChangeReason, pending.stage, true);
        }}
      />

      <Dialog
        open={Boolean(closedMonthStage)}
        onOpenChange={(open) => {
          if (!open && !applyResumeRequired) {
            setClosedMonthStage(null);
            setApplyResumeRequired(false);
            setClosedMonthWarning([]);
            setClosedMonthFormulaAccepted(false);
          }
        }}
      >
        <DialogContent className="max-w-[360px] gap-4 rounded-xl p-5 sm:max-w-[360px]">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-[17px]">{applyResumeRequired ? '시트 반영 이어서 완료' : '결산 후 값이 달라요'}</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed text-slate-600">
              {applyResumeRequired
                ? '이전 반영의 응답을 확인하지 못했습니다. 새 검토본을 만들지 않고 같은 작업을 이어서 완료합니다.'
                : '월 결산 이후 변경입니다. 사유를 남기면 변경 이력과 경고 횟수에 함께 기록됩니다.'}
            </DialogDescription>
          </DialogHeader>
          {!applyResumeRequired && closedMonthWarning.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-950">
              {closedMonthWarning.slice(0, 3).map((summary) => (
                <div key={summary.yearMonth}>{formatClosedMonthDifference(summary)}</div>
              ))}
              {closedMonthWarning.length > 3 && <div>외 {closedMonthWarning.length - 3}개 월</div>}
            </div>
          )}
          {!applyResumeRequired && (
            <textarea
              value={closedMonthChangeReason}
              onChange={(event) => setClosedMonthChangeReason(event.target.value.slice(0, 1000))}
              placeholder="예: 결산 후 확인된 실제 입금액 정정"
              className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]"
              disabled={loading}
            />
          )}
          <DialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            {!applyResumeRequired && (
              <Button type="button" variant="outline" className="h-9" onClick={() => setClosedMonthStage(null)}>
                닫기
              </Button>
            )}
            <Button
              type="button"
              className="h-9"
              disabled={loading || !closedMonthStage || (!applyResumeRequired && !closedMonthChangeReason.trim())}
              onClick={() => void handleOverwriteSheetValues(
                closedMonthChangeReason.trim(),
                closedMonthStage,
                closedMonthFormulaAccepted,
              )}
            >
              {applyResumeRequired ? '같은 작업 이어서 완료' : '사유와 함께 반영'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={tutorialOpen} onOpenChange={handleTutorialOpenChange}>
        <DialogContent
          aria-modal="true"
          className="max-w-[680px] gap-0 overflow-hidden rounded-[24px] border-0 bg-white p-0 shadow-[0_28px_90px_rgba(0,30,70,0.3)] sm:max-w-[680px] [&>button]:text-white [&>button]:opacity-80"
        >
          <div className="bg-[#001e46] px-6 pb-5 pt-6 text-white sm:px-8">
            <div className="mb-5 flex items-center justify-between gap-4 pr-8">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold tracking-[0.08em]">
                <BookOpen className="h-3.5 w-3.5" />
                SHEET QUEST
              </div>
              <div className="max-w-[220px] truncate text-[11px] text-blue-100" title={projectId}>
                프로젝트 {projectId || '선택 전'}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2" aria-label={`가이드 ${tutorialSlide + 1}/4`}>
              {[0, 1, 2, 3].map((step) => (
                <span
                  key={step}
                  className={`h-1.5 rounded-full ${step <= tutorialSlide ? 'bg-[#4f7cff]' : 'bg-white/20'}`}
                />
              ))}
            </div>
          </div>

          <div className="min-h-[360px] px-6 py-7 sm:px-8">
            {tutorialSlide === 0 && (
              <>
                <DialogHeader>
                  <div className="text-[12px] font-bold text-blue-700">MISSION 1 · 전체 흐름</div>
                  <DialogTitle className="text-[25px] font-black leading-tight text-slate-950">
                    시트 연동은 세 번만 누르면 끝나요
                  </DialogTitle>
                  <DialogDescription className="text-[14px] leading-relaxed text-slate-600">
                    안내가 끝나면 지금 해야 할 버튼으로 바로 이동해 드릴게요.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {[
                    ['1', '시트 정보 저장', '링크와 탭 이름을 기억해요.'],
                    ['2', '시트 값 가져오기', '버튼을 누른 시점의 값을 고정해요.'],
                    ['3', '시트 값으로 덮어쓰기', '별도 검토 없이 MYSCube에 반영해요.'],
                  ].map(([number, title, description]) => (
                    <div key={number} className="border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-5 flex h-8 w-8 items-center justify-center rounded-full bg-[#001e46] text-[12px] font-black text-white">
                        {number}
                      </div>
                      <div className="text-[14px] font-bold text-slate-950">{title}</div>
                      <div className="mt-1 text-[12px] leading-relaxed text-slate-500">{description}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tutorialSlide === 1 && (
              <>
                <DialogHeader>
                  <div className="text-[12px] font-bold text-blue-700">MISSION 2 · 연결 정보</div>
                  <DialogTitle className="text-[25px] font-black leading-tight text-slate-950">
                    이 네 칸만 시트와 똑같이 적어주세요
                  </DialogTitle>
                  <DialogDescription className="text-[14px] leading-relaxed text-slate-600">
                    Google Sheet 링크, 탭 이름, 시작 주차와 종료 주차를 입력합니다.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-6 border-2 border-blue-200 bg-blue-50/60 p-4 shadow-[0_12px_30px_rgba(79,124,255,0.1)]">
                  <div className="mb-3 h-10 border border-blue-300 bg-white px-3 py-2 text-[12px] text-slate-400">
                    https://docs.google.com/spreadsheets/d/...
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700">cashflow(사용내역 연동)</div>
                    <div className="border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700">{startWeek || '예: 26-1-1'}</div>
                    <div className="border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700">{endWeek || '예: 26-12-5'}</div>
                  </div>
                </div>
                <div className="mt-4 flex gap-3 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-[12px] leading-relaxed text-amber-950">
                  <span className="font-black">TIP</span>
                  <span>`시트 접근 권한이 필요한가요?`를 열고 <strong>공유 계정 확인 → 공유 계정 복사</strong> 순서로 누르면 돼요.</span>
                </div>
              </>
            )}

            {tutorialSlide === 2 && (
              <>
                <DialogHeader>
                  <div className="text-[12px] font-bold text-blue-700">MISSION 3 · 연도 구조</div>
                  <DialogTitle className="text-[25px] font-black leading-tight text-slate-950">
                    연간 합계와 주차 값을 알아서 구분해요
                  </DialogTitle>
                  <DialogDescription className="text-[14px] leading-relaxed text-slate-600">
                    시트 서식을 억지로 바꿀 필요 없이 현재 구조 그대로 가져옵니다.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(detectedYearModes.length > 0 ? detectedYearModes : [
                    { year: '연도 합계 열', mode: '연간 합계' },
                    { year: '주차 열', mode: '주차별 값' },
                    { year: '없는 연도', mode: '오류 아님' },
                  ]).map(({ year, mode }) => (
                    <div key={String(year)} className={`p-4 text-center ${mode === '주차별 값' ? 'bg-[#001e46] text-white shadow-lg' : 'border border-slate-200 bg-slate-50 text-slate-900'}`}>
                      <div className="text-[18px] font-black">{typeof year === 'number' ? `${year}년` : year}</div>
                      <div className={`mt-2 text-[11px] font-semibold ${mode === '주차별 값' ? 'text-blue-100' : 'text-slate-500'}`}>{mode}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-2 text-[13px] leading-relaxed text-slate-700">
                  <p><strong>연간 합계는 임의의 주차로 나누지 않고</strong> 해당 연도의 합계로 그대로 저장합니다.</p>
                  <p><strong>주차 열이 있는 연도만 주차별로 저장</strong>하며, 시트에 없는 연도는 오류로 처리하지 않습니다.</p>
                </div>
              </>
            )}

            {tutorialSlide === 3 && (
              <>
                <DialogHeader>
                  <div className="text-[12px] font-bold text-emerald-700">FINAL MISSION · 저장</div>
                  <DialogTitle className="text-[25px] font-black leading-tight text-slate-950">
                    버튼 문구만 보고 순서대로 눌러주세요
                  </DialogTitle>
                  <DialogDescription className="text-[14px] leading-relaxed text-slate-600">
                    자동 동기화하지 않으며, 마지막 버튼을 누를 때만 시트 값으로 덮어씁니다.
                  </DialogDescription>
                </DialogHeader>
                <ol className="mt-6 space-y-3">
                  {[
                    ['1', '시트 정보 저장', '어느 시트를 읽을지 저장'],
                    ['2', '시트 값 가져오기', '가져온 값을 서버에 고정'],
                    ['3', '시트 값으로 덮어쓰기', 'Projection과 Actual을 바로 반영'],
                  ].map(([number, title, description]) => (
                    <li key={number} className="flex items-center gap-3 border border-slate-200 px-4 py-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-black text-blue-800">{number}</span>
                      <span className="min-w-0 flex-1 text-[13px] font-bold text-slate-950">{title}</span>
                      <span className="hidden text-[11px] text-slate-500 sm:block">{description}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4 sm:px-8">
            <Button
              type="button"
              variant="ghost"
              className="h-10 gap-1 px-2 text-[13px]"
              disabled={tutorialSlide === 0}
              onClick={() => setTutorialSlide((current) => Math.max(0, current - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> 이전
            </Button>
            {tutorialSlide < 3 ? (
              <Button
                type="button"
                className="h-10 gap-1.5 bg-[#001e46] px-5 text-[13px] text-white hover:bg-[#082c5a]"
                onClick={() => setTutorialSlide((current) => Math.min(3, current + 1))}
              >
                다음 미션 <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                className="h-10 gap-1.5 bg-emerald-600 px-5 text-[13px] text-white hover:bg-emerald-700"
                onClick={finishTutorial}
              >
                지금 해야 할 곳으로 이동 <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    {loadingOperation ? <CashflowSheetSyncOverlay operation={loadingOperation} /> : null}
    </>
  );
}
