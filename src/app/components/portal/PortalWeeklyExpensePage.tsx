import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Send, Settings2 } from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { useAuth } from '../../data/auth-store';
import { SettlementLedgerPage } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import type { CashflowWeekSheet, Transaction, TransactionState } from '../../data/types';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';
import {
  provisionTransactionEvidenceDriveViaBff,
  syncTransactionEvidenceDriveViaBff,
} from '../../lib/platform-bff-client';
import { PlatformApiError } from '../../platform/api-client';

export function PortalWeeklyExpensePage() {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const {
    portalUser,
    myProject,
    ledgers,
    transactions,
    addTransaction,
    updateTransaction,
    changeTransactionState,
    evidenceRequiredMap,
    saveEvidenceRequiredMap,
    expenseSheets,
    activeExpenseSheetId,
    setActiveExpenseSheet,
    createExpenseSheet,
    renameExpenseSheet,
    deleteExpenseSheet,
    expenseSheetRows,
    saveExpenseSheetRows,
    comments,
    addComment,
    participationEntries,
    budgetCodeBook,
  } = usePortalStore();
  const { submitWeekAsPm } = useCashflowWeeks();

  const projectId = portalUser?.projectId || '';
  const projectName = myProject?.name || '내 사업';
  const ledgerUserRole = portalUser?.role === 'pm' || portalUser?.role === 'viewer' ? 'pm' : 'admin';
  const visibleExpenseSheets = useMemo(() => (
    expenseSheets.length > 0
      ? expenseSheets
      : [{ id: 'default', name: '기본 탭', rows: expenseSheetRows, order: 0 }]
  ), [expenseSheets, expenseSheetRows]);
  const activeSheetName = useMemo(() => {
    return visibleExpenseSheets.find((sheet) => sheet.id === activeExpenseSheetId)?.name || visibleExpenseSheets[0]?.name || '기본 탭';
  }, [visibleExpenseSheets, activeExpenseSheetId]);

  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [projectId, ledgers]);

  const authorOptions = useMemo(() => {
    const names = new Set<string>();
    participationEntries
      .filter((e) => e.projectId === projectId)
      .forEach((e) => {
        if (e.memberName) names.add(e.memberName);
      });
    if (portalUser?.name) names.add(portalUser.name);
    if (myProject?.managerName) names.add(myProject.managerName);
    if (myProject?.settlementSupportName) names.add(myProject.settlementSupportName);
    return Array.from(names).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [participationEntries, projectId, portalUser?.name, myProject?.managerName, myProject?.settlementSupportName]);

  const bffActor = useMemo(() => ({
    uid: authUser?.uid || portalUser?.id || 'portal-user',
    email: authUser?.email || portalUser?.email || '',
    role: portalUser?.role || authUser?.role || 'pm',
    idToken: authUser?.idToken,
  }), [authUser?.uid, authUser?.email, authUser?.role, authUser?.idToken, portalUser?.id, portalUser?.email, portalUser?.role]);

  const handleEvidenceDriveError = (error: unknown, actionLabel: string) => {
    console.error(`[PortalWeeklyExpensePage] ${actionLabel} failed:`, error);
    if (error instanceof PlatformApiError) {
      const message = typeof error.body === 'object' && error.body && 'message' in (error.body as Record<string, unknown>)
        ? String((error.body as Record<string, unknown>).message || '')
        : error.message;
      toast.error(message || `${actionLabel}에 실패했습니다.`);
      return;
    }
    toast.error(`${actionLabel}에 실패했습니다.`);
  };

  const provisionEvidenceDrive = async (tx: Transaction) => {
    try {
      const result = await provisionTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      toast.success(`증빙 폴더 연결 완료: ${result.folderName}`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 폴더 생성');
      throw error;
    }
  };

  const syncEvidenceDrive = async (tx: Transaction) => {
    try {
      const result = await syncTransactionEvidenceDriveViaBff({
        tenantId: orgId,
        actor: bffActor,
        transactionId: tx.id,
      });
      toast.success(`증빙 동기화 완료: ${result.evidenceCount}건`);
    } catch (error) {
      handleEvidenceDriveError(error, '증빙 동기화');
      throw error;
    }
  };

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold">사업비 입력(주간)</h2>
          <p className="text-[12px] text-muted-foreground mt-1">
            현재 탭: {activeSheetName}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {visibleExpenseSheets.map((sheet) => (
            <Button
              key={sheet.id}
              variant={sheet.id === activeExpenseSheetId ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-[11px]"
              onClick={() => setActiveExpenseSheet(sheet.id)}
            >
              {sheet.name}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={async () => {
              const raw = window.prompt('새 탭 이름을 입력하세요.', `탭 ${visibleExpenseSheets.length + 1}`);
              if (raw == null) return;
              const trimmed = raw.trim();
              if (!trimmed) return;
              const created = await createExpenseSheet(trimmed);
              if (created) toast.success('새 탭을 만들었습니다.');
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            탭 추가
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px] gap-1"
            onClick={async () => {
              const raw = window.prompt('탭 이름을 수정하세요.', activeSheetName);
              if (raw == null) return;
              const trimmed = raw.trim();
              if (!trimmed) return;
              const ok = await renameExpenseSheet(activeExpenseSheetId || visibleExpenseSheets[0]?.id || 'default', trimmed);
              if (ok) toast.success('탭 이름을 수정했습니다.');
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            이름 변경
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-[11px]"
            disabled={visibleExpenseSheets.length <= 1}
            onClick={async () => {
              const targetId = activeExpenseSheetId || visibleExpenseSheets[0]?.id || 'default';
              const ok = await deleteExpenseSheet(targetId);
              if (ok) toast.success('탭을 삭제했습니다.');
            }}
          >
            탭 삭제
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-[12px] text-amber-900">
        <p className="font-semibold">매입 부가세 입력 안내</p>
        <p className="mt-1 text-amber-800/90">
          부가세는 계산값이 아니라 영수증/세금계산서 증빙 기준 금액으로 입력하세요. 통장금액만 있고 사업비 사용액이 비어 있으면
          입력한 부가세를 기준으로 공급가액이 자동 보조 계산됩니다.
        </p>
      </div>
      <VarianceFlagBanner
        projectId={projectId}
        pmName={portalUser?.name || 'PM'}
        pmUid={portalUser?.id || ''}
      />
      <SettlementLedgerPage
        projectId={projectId}
        projectName={projectName}
        transactions={transactions}
        defaultLedgerId={defaultLedgerId}
        onAddTransaction={addTransaction}
        onUpdateTransaction={updateTransaction}
        authorOptions={authorOptions}
        budgetCodeBook={budgetCodeBook}
        hideYearControls
        hideCountBadge
        autoSaveSheet
        evidenceRequiredMap={evidenceRequiredMap}
        onSaveEvidenceRequiredMap={saveEvidenceRequiredMap}
        sheetRows={expenseSheetRows}
        onSaveSheetRows={saveExpenseSheetRows}
        onSubmitWeek={async ({ yearMonth, weekNo, txIds }) => {
          try {
            await submitWeekAsPm({ projectId, yearMonth, weekNo });
            for (const txId of txIds) changeTransactionState(txId, 'SUBMITTED');
            toast.success(`${yearMonth} ${weekNo}주 제출 처리 완료`);
          } catch (err) {
            toast.error('주간 제출 처리에 실패했습니다');
            throw err;
          }
        }}
        onChangeTransactionState={(txId, newState, reason) => changeTransactionState(txId, newState, reason)}
        currentUserName={portalUser?.name || 'PM'}
        currentUserId={portalUser?.id || 'pm'}
        userRole={ledgerUserRole}
        comments={comments}
        onAddComment={addComment}
        onProvisionEvidenceDrive={provisionEvidenceDrive}
        onSyncEvidenceDrive={syncEvidenceDrive}
      />
    </div>
  );
}

// ── PM 편차 확인 배너 ──

function VarianceFlagBanner({
  projectId,
  pmName,
  pmUid,
}: {
  projectId: string;
  pmName: string;
  pmUid: string;
}) {
  const { weeks } = useCashflowWeeks();
  const [replyText, setReplyText] = useState('');
  const [replyingId, setReplyingId] = useState<string | null>(null);

  // Find all OPEN flags for this project
  const openFlags = useMemo(() => {
    return weeks.filter(
      (w) =>
        w.projectId === projectId &&
        w.varianceFlag?.status === 'OPEN',
    );
  }, [weeks, projectId]);

  const { updateVarianceFlag } = useCashflowWeeks();

  const handleReply = (sheet: CashflowWeekSheet) => {
    if (!replyText.trim() || !sheet.varianceFlag) return;
    const now = new Date().toISOString();
    const nextFlag = {
      ...sheet.varianceFlag,
      status: 'REPLIED' as const,
      pmReply: replyText.trim(),
      pmRepliedBy: pmName,
      pmRepliedByUid: pmUid,
      pmRepliedAt: now,
    };
    const nextHistory = [
      ...(sheet.varianceHistory || []),
      { id: `vf-${Date.now()}`, action: 'REPLY' as const, actor: pmName, actorUid: pmUid, content: replyText.trim(), timestamp: now },
    ];
    updateVarianceFlag({ sheetId: sheet.id, varianceFlag: nextFlag, varianceHistory: nextHistory }).catch(console.error);
    setReplyText('');
    setReplyingId(null);
  };

  if (openFlags.length === 0) return null;

  return (
    <div className="space-y-2">
      {openFlags.map((sheet) => {
        const flag = sheet.varianceFlag!;
        const weekLabel = `${sheet.yearMonth} ${sheet.weekNo}주`;
        const isReplying = replyingId === sheet.id;

        return (
          <div
            key={sheet.id}
            className="flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-200">
                  관리자 확인요청 | {weekLabel}
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                  "{flag.reason}"
                </p>
                <p className="text-[9px] text-amber-600/70 mt-0.5">
                  {flag.flaggedBy} · {flag.flaggedAt.slice(0, 16).replace('T', ' ')}
                </p>
              </div>
              {!isReplying && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] shrink-0 border-amber-400 text-amber-700 hover:bg-amber-100"
                  onClick={() => setReplyingId(sheet.id)}
                >
                  답변
                </Button>
              )}
            </div>
            {isReplying && (
              <div className="flex gap-2 ml-6">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="사유를 입력하세요..."
                  className="flex-1 h-8 rounded-md border bg-background px-2.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleReply(sheet);
                    if (e.key === 'Escape') setReplyingId(null);
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 text-[11px] gap-1 px-3"
                  onClick={() => handleReply(sheet)}
                  disabled={!replyText.trim()}
                >
                  <Send className="h-3 w-3" />
                  전송
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
