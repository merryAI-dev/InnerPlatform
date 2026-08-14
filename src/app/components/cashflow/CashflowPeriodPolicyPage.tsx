import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarRange, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchCashflowPeriodPolicy,
  recoverCashflowCumulativeCloseHead,
  resetCashflowCumulativeCloseToReclose,
  updateCashflowExecutiveApprover,
  type CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  type CashflowPeriodPolicyProjectItem,
  type CashflowPeriodPolicyResponse,
} from '../../lib/cashflow-period-policy-client';
import { isPlatformApiEnabled } from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';
import { PageHeader } from '../layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { CashflowPeriodPolicySections, StatusBadge } from './CashflowPeriodPolicySections';

export type CashflowPeriodPolicyViewState =
  | { kind: 'loading' }
  | { kind: 'empty'; snapshot: CashflowPeriodPolicyResponse }
  | { kind: 'error'; message: string }
  | { kind: 'forbidden' }
  | { kind: 'ready'; snapshot: CashflowPeriodPolicyResponse };

interface CashflowPeriodPolicyViewProps {
  state: CashflowPeriodPolicyViewState;
  savingProjectId: string;
  recoveringProjectId: string;
  resettingProjectId: string;
  onRetry: () => void;
  onUpdateExecutiveApprover: (
    item: CashflowPeriodPolicyProjectItem,
    approverUid: string,
    reason: string,
  ) => Promise<void>;
  onRecoverCumulativeCloseHead: (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
  ) => Promise<void>;
  onResetCumulativeCloseToReclose: (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  ) => Promise<void>;
}

export function resolveCashflowPeriodPolicyRecoveryError(error: unknown): string {
  if (!(error instanceof PlatformApiError)) {
    return '복구 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속되면 AXR팀에 프로젝트 ID와 함께 알려 주세요.';
  }
  if (error.status === 403) {
    return 'People UID가 연결된 ACTIVE runtime admin 권한을 확인해 주세요.';
  }
  if (error.code === 'cashflow_close_head_recovery_normal_reopen_required'
    || error.code === 'cashflow_close_reset_to_reclose_normal_reopen_required') {
    return '이미 유효한 마감 권한입니다. 복구 대신 프로젝트의 정상 재오픈 절차를 사용해 주세요.';
  }
  if (error.code === 'cashflow_close_reset_to_reclose_exact_recovery_required') {
    return '정확 복구가 가능한 상태입니다. 현재 화면을 다시 불러온 뒤 누적 마감 권한 복구를 먼저 실행해 주세요.';
  }
  if (error.status === 409) {
    return '복구 근거가 변경되었거나 현재 상태와 맞지 않습니다. 화면을 다시 불러온 뒤 최신 근거로 다시 시도해 주세요.';
  }
  return '복구 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속되면 AXR팀에 프로젝트 ID와 함께 알려 주세요.';
}

function Header({ snapshot, onRetry }: { snapshot?: CashflowPeriodPolicyResponse; onRetry: () => void }) {
  return (
    <PageHeader
      icon={CalendarRange}
      iconGradient="linear-gradient(135deg, #0f766e, #2dd4bf)"
      title="현금흐름 기간·마감 정책"
      description="서버 authority 기준으로 기간 grain, 월결산 실행, 권한, source revision을 분리해 확인합니다."
      badge={snapshot?.statusLabel}
      actions={snapshot ? (
        <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          다시 불러오기
        </Button>
      ) : undefined}
    />
  );
}

export function CashflowPeriodPolicyView({
  state,
  savingProjectId,
  recoveringProjectId,
  resettingProjectId,
  onRetry,
  onUpdateExecutiveApprover,
  onRecoverCumulativeCloseHead,
  onResetCumulativeCloseToReclose,
}: CashflowPeriodPolicyViewProps) {
  if (state.kind === 'loading') {
    return (
      <div className="space-y-5">
        <Header onRetry={onRetry} />
        <div role="status" aria-busy="true" aria-label="기간·마감 정책을 불러오는 중입니다" className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            기간·마감 정책을 불러오는 중입니다.
          </p>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  if (state.kind === 'forbidden') {
    return (
      <div className="space-y-5">
        <Header onRetry={onRetry} />
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>기간·마감 정책 접근 권한이 없습니다</AlertTitle>
          <AlertDescription>AXR 관리자 권한과 현재 조직을 확인해 주세요.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="space-y-5">
        <Header onRetry={onRetry} />
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>기간·마감 정책을 표시할 수 없습니다</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>다시 불러오기</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className="space-y-5">
        <Header snapshot={state.snapshot} onRetry={onRetry} />
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarRange className="mx-auto h-9 w-9 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">표시할 현금흐름 기간·마감 정책이 없습니다</h2>
            <p className="mt-1 text-xs text-muted-foreground">서버 스냅샷 생성 시각: {state.snapshot.generatedAtLabel}</p>
          </CardContent>
        </Card>
        <CashflowPeriodPolicySections
          snapshot={state.snapshot}
          savingProjectId={savingProjectId}
          recoveringProjectId={recoveringProjectId}
          resettingProjectId={resettingProjectId}
          onUpdateExecutiveApprover={onUpdateExecutiveApprover}
          onRecoverCumulativeCloseHead={onRecoverCumulativeCloseHead}
          onResetCumulativeCloseToReclose={onResetCumulativeCloseToReclose}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Header snapshot={state.snapshot} onRetry={onRetry} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <StatusBadge status={state.snapshot.status} label={state.snapshot.statusLabel} tone={state.snapshot.tone} />
        <p className="text-xs text-muted-foreground">
          서버 스냅샷 {state.snapshot.generatedAtLabel}
          <span className="sr-only">{state.snapshot.generatedAt}</span>
        </p>
      </div>
      <CashflowPeriodPolicySections
        snapshot={state.snapshot}
        savingProjectId={savingProjectId}
        recoveringProjectId={recoveringProjectId}
        resettingProjectId={resettingProjectId}
        onUpdateExecutiveApprover={onUpdateExecutiveApprover}
        onRecoverCumulativeCloseHead={onRecoverCumulativeCloseHead}
        onResetCumulativeCloseToReclose={onResetCumulativeCloseToReclose}
      />
    </div>
  );
}

export function CashflowPeriodPolicyPage() {
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [state, setState] = useState<CashflowPeriodPolicyViewState>({ kind: 'loading' });
  const [refreshToken, setRefreshToken] = useState(0);
  const [savingProjectId, setSavingProjectId] = useState('');
  const [recoveringProjectId, setRecoveringProjectId] = useState('');
  const [resettingProjectId, setResettingProjectId] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setState({ kind: 'forbidden' });
      return () => { cancelled = true; };
    }
    if (!isPlatformApiEnabled()) {
      setState({ kind: 'error', message: '기간·마감 정책 서버 연결을 사용할 수 없습니다.' });
      return () => { cancelled = true; };
    }

    setState({ kind: 'loading' });
    void fetchCashflowPeriodPolicy({ tenantId: orgId, actor: user })
      .then((snapshot) => {
        if (cancelled) return;
        setState(snapshot.items.length === 0 ? { kind: 'empty', snapshot } : { kind: 'ready', snapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof PlatformApiError && error.status === 403) {
          setState({ kind: 'forbidden' });
          return;
        }
        setState({
          kind: 'error',
          message: '기간·마감 정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        });
      });
    return () => { cancelled = true; };
  }, [orgId, refreshToken, user?.uid, user?.idToken]);

  const retry = () => setRefreshToken((value) => value + 1);

  const updateExecutiveApprover = async (
    item: CashflowPeriodPolicyProjectItem,
    approverUid: string,
    reason: string,
  ) => {
    if (!user) return;
    setSavingProjectId(item.project.id);
    try {
      await updateCashflowExecutiveApprover({
        tenantId: orgId,
        actor: user,
        projectId: item.project.id,
        approverUid,
        expectedVersion: item.executiveApprover.expectedVersion,
        reason,
        idempotencyKey: `cashflow-period-policy-${crypto.randomUUID()}`,
      });
      toast.success(`${item.project.name} 조직장 People UID를 연결했습니다.`);
      retry();
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && error.status === 403) {
        setState({ kind: 'forbidden' });
      } else {
        toast.error('조직장 People UID를 연결하지 못했습니다. 화면을 다시 불러온 뒤 다시 시도해 주세요.');
      }
    } finally {
      setSavingProjectId('');
    }
  };

  const recoverCumulativeCloseHead = async (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
  ) => {
    if (!user || !item.recovery.expectedEvidence) return;
    setRecoveringProjectId(item.project.id);
    try {
      const result = await recoverCashflowCumulativeCloseHead({
        tenantId: orgId,
        actor: user,
        projectId: item.project.id,
        reason,
        expectedEvidence: item.recovery.expectedEvidence,
        idempotencyKey: `cashflow-close-head-recovery-${crypto.randomUUID()}`,
      });
      toast.success(`${item.project.name} · ${result.statusLabel}`);
      retry();
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && error.status === 403) {
        setState({ kind: 'forbidden' });
      } else {
        toast.error(resolveCashflowPeriodPolicyRecoveryError(error));
      }
    } finally {
      setRecoveringProjectId('');
    }
  };

  const resetCumulativeCloseToReclose = async (
    item: CashflowPeriodPolicyProjectItem,
    reason: string,
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
  ) => {
    if (!user) return;
    setResettingProjectId(item.project.id);
    try {
      const result = await resetCashflowCumulativeCloseToReclose({
        tenantId: orgId,
        actor: user,
        projectId: item.project.id,
        reason,
        expectedEvidence,
        idempotencyKey: `cashflow-close-reset-to-reclose-${crypto.randomUUID()}`,
      });
      toast.success(`${item.project.name} · ${result.statusLabel}`);
      retry();
    } catch (error: unknown) {
      if (error instanceof PlatformApiError && error.status === 403) {
        setState({ kind: 'forbidden' });
      } else {
        toast.error(resolveCashflowPeriodPolicyRecoveryError(error));
      }
    } finally {
      setResettingProjectId('');
    }
  };

  return (
    <CashflowPeriodPolicyView
      state={state}
      savingProjectId={savingProjectId}
      recoveringProjectId={recoveringProjectId}
      resettingProjectId={resettingProjectId}
      onRetry={retry}
      onUpdateExecutiveApprover={updateExecutiveApprover}
      onRecoverCumulativeCloseHead={recoverCumulativeCloseHead}
      onResetCumulativeCloseToReclose={resetCumulativeCloseToReclose}
    />
  );
}
