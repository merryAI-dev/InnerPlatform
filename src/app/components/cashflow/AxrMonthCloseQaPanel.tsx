import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardCopy, Loader2, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Input } from '../ui/input';
import { resolveApiErrorMessage } from '../../platform/api-error-message';
import {
  createPlatformApiClient,
  decideCashflowMonthReopenViaBff,
  requestCashflowMonthReopenViaBff,
  approveCashflowMonthCloseUntilLedgerClosed,
  reviewCashflowMonthCloseRequestViaBff,
  toRequestActor,
  type ActorLike,
} from '../../lib/platform-bff-client';

export const AXR_MONTH_CLOSE_QA_PROJECT_ID = 'p1773817948751';
export const AXR_MONTH_CLOSE_QA_PROJECT_NAME = 'AXR프로젝트경비경';

type QaAction = 'REQUEST_CLOSE' | 'APPROVE_REQUEST' | 'REJECT_REQUEST' | 'REQUEST_REOPEN' | 'APPROVE_REOPEN' | 'REJECT_REOPEN' | 'REFRESH';

export interface QaControl {
  enabled: true;
  projectId: string;
  projectName: string;
  yearMonth: string;
  close: { status: string; revision: number; snapshotHash: string | null; latestVersionId: string | null };
  request: { requestId: string; status: string; revision: number; manifestHash: string | null; approverUid: string | null } | null;
  cumulativeHead: { closedThrough: string | null; rootHash: string | null; revision: number } | null;
  allowedActions: QaAction[];
  confirmationToken: string;
}

const apiClient = createPlatformApiClient();

const ACTION_LABELS: Record<QaAction, string> = {
  REQUEST_CLOSE: '월 결산 요청 준비',
  APPROVE_REQUEST: '월 결산 승인',
  REJECT_REQUEST: '월 결산 요청 반려',
  REQUEST_REOPEN: '재오픈 요청',
  APPROVE_REOPEN: '재오픈 승인',
  REJECT_REOPEN: '재오픈 반려',
  REFRESH: '상태 새로고침',
};

function isMutation(action: QaAction) {
  return !['REQUEST_CLOSE', 'REFRESH'].includes(action);
}

export function isAxrMonthCloseQaEligible(input: { projectId: string; projectName?: string; role: string }) {
  return input.projectId === AXR_MONTH_CLOSE_QA_PROJECT_ID
    && input.projectName === AXR_MONTH_CLOSE_QA_PROJECT_NAME
    && ['admin', 'finance'].includes(input.role);
}

export function resolveAxrMonthCloseQaResetAction(actions: QaAction[]): QaAction {
  if (actions.includes('REJECT_REQUEST')) return 'REJECT_REQUEST';
  if (actions.includes('REQUEST_REOPEN')) return 'REQUEST_REOPEN';
  if (actions.includes('APPROVE_REOPEN')) return 'APPROVE_REOPEN';
  return 'REFRESH';
}

type QaMutationClients = {
  reviewRequest: typeof reviewCashflowMonthCloseRequestViaBff;
  requestReopen: typeof requestCashflowMonthReopenViaBff;
  decideReopen: typeof decideCashflowMonthReopenViaBff;
};

const qaMutationClients: QaMutationClients = {
  reviewRequest: reviewCashflowMonthCloseRequestViaBff,
  requestReopen: requestCashflowMonthReopenViaBff,
  decideReopen: decideCashflowMonthReopenViaBff,
};

export async function executeAxrMonthCloseQaAction({
  action,
  control,
  projectId,
  yearMonth,
  tenantId,
  actor,
  reason,
  confirmation,
  backupConfirmed,
  clients = qaMutationClients,
}: {
  action: QaAction;
  control: QaControl;
  projectId: string;
  yearMonth: string;
  tenantId: string;
  actor: ActorLike;
  reason: string;
  confirmation: string;
  backupConfirmed: boolean;
  clients?: QaMutationClients;
}) {
  if (projectId !== AXR_MONTH_CLOSE_QA_PROJECT_ID
    || control.projectId !== AXR_MONTH_CLOSE_QA_PROJECT_ID
    || control.projectName !== AXR_MONTH_CLOSE_QA_PROJECT_NAME
    || control.yearMonth !== yearMonth
    || !control.allowedActions.includes(action)
    || !isMutation(action)) throw new Error('허용되지 않은 AXR 월 결산 QA 작업입니다.');
  if (!backupConfirmed || confirmation !== control.confirmationToken || !reason.trim()) {
    throw new Error('백업 확인, 사유, 확인 문구를 모두 입력해 주세요.');
  }

  if (action === 'APPROVE_REQUEST' || action === 'REJECT_REQUEST') {
    if (!control.request) throw new Error('검토할 월 결산 요청이 없습니다.');
    const reviewInput = {
      tenantId,
      actor,
      projectId,
      requestId: control.request.requestId,
      payload: {
        decision: action === 'APPROVE_REQUEST' ? ('APPROVE' as const) : ('REJECT' as const),
        expectedRevision: control.request.revision,
        expectedManifestHash: control.request.manifestHash || undefined,
        reason: reason.trim(),
      },
      // 결정적 키. 이어받기 호출이 같은 키를 써야 JVM 이 앞선 시도를 인식하고 reconcile 된다.
      idempotencyKey: `axr-month-close-qa:${action}:${control.request.requestId}:r${control.request.revision}`,
    };
    if (action === 'REJECT_REQUEST') return clients.reviewRequest(reviewInput);
    // 승인은 접수됐고 장부 잠금만 남은 상태면 끝날 때까지 이어받는다. 이어받기 규칙은
    // platform-bff-client 한 곳에만 두고 승인 화면들이 공유한다.
    return approveCashflowMonthCloseUntilLedgerClosed(reviewInput);
  }
  if (action === 'REQUEST_REOPEN') {
    return clients.requestReopen({
      tenantId,
      actor,
      projectId,
      payload: { yearMonth, expectedRevision: control.close.revision, reason: reason.trim() },
      idempotencyKey: `axr-month-close-qa:${action}:${projectId}:${yearMonth}:r${control.close.revision}`,
    });
  }
  return clients.decideReopen({
    tenantId,
    actor,
    projectId,
    payload: {
      yearMonth,
      expectedRevision: control.close.revision,
      decision: action === 'APPROVE_REOPEN' ? 'APPROVE' : 'REJECT',
      reason: reason.trim(),
    },
    idempotencyKey: `axr-month-close-qa:${action}:${projectId}:${yearMonth}:r${control.close.revision}`,
  });
}

export function AxrMonthCloseQaPanel({
  projectId,
  projectName,
  yearMonth,
  tenantId,
  role,
  resolveActor,
  onOpenMonthCloseRequest,
  onRefresh,
}: {
  projectId: string;
  projectName?: string;
  yearMonth: string;
  tenantId: string;
  role: string;
  resolveActor: () => Promise<ActorLike | null>;
  onOpenMonthCloseRequest: () => void;
  onRefresh: () => Promise<void>;
}) {
  const eligible = isAxrMonthCloseQaEligible({ projectId, projectName, role });
  const [control, setControl] = useState<QaControl | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedAction, setSelectedAction] = useState<QaAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const mutationInFlight = useRef(false);

  const loadControl = useCallback(async () => {
    if (!eligible || !tenantId) return;
    setLoading(true);
    try {
      const actor = await resolveActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      const response = await apiClient.get<QaControl>(
        `/api/v1/qa/axr-month-close/${encodeURIComponent(projectId)}/control?yearMonth=${encodeURIComponent(yearMonth)}`,
        { tenantId, actor: toRequestActor(actor), retries: 0, timeoutMs: 12_000 },
      );
      setControl(response.data);
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        setControl(null);
        return;
      }
      toast.error(resolveApiErrorMessage(error, 'AXR 월 결산 QA 상태를 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [eligible, projectId, resolveActor, tenantId, yearMonth]);

  useEffect(() => {
    setControl(null);
    void loadControl();
  }, [loadControl]);

  const resetAction = useMemo<QaAction>(() => resolveAxrMonthCloseQaResetAction(control?.allowedActions || []), [control]);

  if (!eligible || (!control && !loading)) return null;

  const refreshAll = async () => {
    await onRefresh();
    await loadControl();
  };

  const startAction = (action: QaAction) => {
    if (action === 'REFRESH') {
      void refreshAll();
      return;
    }
    if (action === 'REQUEST_CLOSE') {
      onOpenMonthCloseRequest();
      return;
    }
    setSelectedAction(action);
    setConfirmation('');
    setReason('');
    setBackupConfirmed(false);
  };

  const runSelectedAction = async () => {
    if (!selectedAction || !control || !isMutation(selectedAction)) return;
    if (!backupConfirmed || confirmation !== control.confirmationToken || !reason.trim()) return;
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const actor = await resolveActor();
      if (!actor?.idToken) throw new Error('로그인 세션이 만료되었습니다.');
      await executeAxrMonthCloseQaAction({ action: selectedAction, control, projectId, yearMonth, tenantId, actor, reason, confirmation, backupConfirmed });
      toast.success(`${ACTION_LABELS[selectedAction]} 처리가 완료되었습니다.`);
      setSelectedAction(null);
      await refreshAll();
    } catch (error) {
      toast.error(resolveApiErrorMessage(error, `${ACTION_LABELS[selectedAction]} 처리를 완료하지 못했습니다.`));
      await refreshAll();
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 p-4" aria-label="AXR 월 결산 라이브 QA 패널">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[14px] font-bold text-amber-950"><ShieldCheck className="h-4 w-4" />LIVE QA 전용 · AXR프로젝트경비경</div>
          <p className="mt-1 text-[12px] leading-5 text-amber-900">테스트 코드입니다. 값·snapshot·감사 기록을 삭제하지 않고 기존 승인·재오픈 정책만 실행합니다.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={loading || busy || !control} onClick={() => void navigator.clipboard?.writeText(JSON.stringify(control, null, 2)).then(() => toast.success('QA 기준값을 복사했습니다.'))}><ClipboardCopy className="mr-1 h-3.5 w-3.5" />기준값 복사</Button>
          <Button type="button" size="sm" variant="outline" disabled={loading || busy} onClick={() => void refreshAll()}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}새로고침</Button>
        </div>
      </div>

      {control ? <>
        <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-white p-2"><dt className="text-slate-500">결산 상태</dt><dd className="mt-1 font-bold text-slate-900">{control.close.status} · r{control.close.revision}</dd></div>
          <div className="rounded-md bg-white p-2"><dt className="text-slate-500">승인 요청</dt><dd className="mt-1 font-bold text-slate-900">{control.request ? `${control.request.status} · r${control.request.revision}` : '없음'}</dd></div>
          <div className="rounded-md bg-white p-2"><dt className="text-slate-500">누적 마감</dt><dd className="mt-1 font-bold text-slate-900">{control.cumulativeHead?.closedThrough || '없음'}</dd></div>
          <div className="rounded-md bg-white p-2"><dt className="text-slate-500">Snapshot</dt><dd className="mt-1 truncate font-mono text-[11px] text-slate-900">{control.close.snapshotHash || '없음'}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {control.allowedActions.filter((action) => action !== 'REFRESH').map((action) => <Button key={action} type="button" size="sm" disabled={busy} onClick={() => startAction(action)}>{ACTION_LABELS[action]}</Button>)}
          <Button type="button" size="sm" variant="destructive" disabled={busy || resetAction === 'REFRESH'} onClick={() => startAction(resetAction)}><RotateCcw className="mr-1 h-3.5 w-3.5" />QA 상태 초기화</Button>
        </div>
        {resetAction === 'REFRESH' ? <p className="mt-2 text-[12px] text-amber-900">현재 상태는 강제로 초기화할 수 없습니다. 서버 결과를 먼저 다시 확인하세요.</p> : null}
      </> : <p className="mt-3 text-[12px] text-amber-900">QA 제어 상태를 확인하는 중입니다.</p>}

      <AlertDialog open={selectedAction !== null} onOpenChange={(open) => { if (!open && !busy) setSelectedAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{selectedAction ? ACTION_LABELS[selectedAction] : 'QA 작업 확인'}</AlertDialogTitle>
            <AlertDialogDescription>이 작업은 Live 원장에 감사 가능한 상태 전이를 남깁니다. 백업과 현재 revision을 확인한 뒤 실행하세요.</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="grid gap-2 text-[12px] font-semibold text-slate-700">사유<Input value={reason} maxLength={1000} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="QA 목적과 복구 범위를 입력하세요." /></label>
          <label className="grid gap-2 text-[12px] font-semibold text-slate-700">확인 문구<Input value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} placeholder={control?.confirmationToken} /></label>
          <label className="flex items-start gap-2 text-[12px] text-slate-700"><input type="checkbox" checked={backupConfirmed} disabled={busy} onChange={(event) => setBackupConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4" /><span>Live 백업 완료 상태와 현재 snapshot·revision을 확인했습니다.</span></label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !backupConfirmed || !reason.trim() || confirmation !== control?.confirmationToken} onClick={(event) => { event.preventDefault(); void runSelectedAction(); }}>{busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}실행</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
