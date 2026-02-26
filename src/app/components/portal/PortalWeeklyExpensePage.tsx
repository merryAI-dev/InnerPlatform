import { useMemo, useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import { usePortalStore } from '../../data/portal-store';
import { useCashflowWeeks } from '../../data/cashflow-weeks-store';
import { SettlementLedgerPage } from '../cashflow/SettlementLedgerPage';
import { Button } from '../ui/button';
import type { CashflowWeekSheet, TransactionState } from '../../data/types';
import { toast } from 'sonner';

export function PortalWeeklyExpensePage() {
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
    expenseSheetRows,
    saveExpenseSheetRows,
  } = usePortalStore();
  const { submitWeekAsPm } = useCashflowWeeks();

  const projectId = portalUser?.projectId || '';
  const projectName = myProject?.name || '내 사업';

  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [projectId, ledgers]);

  if (!projectId) {
    return (
      <div className="p-6 text-[12px] text-muted-foreground">
        배정된 사업이 없습니다. 관리자에게 사업 배정을 요청하세요.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold">사업비 입력(주간)</h2>
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
        userRole="pm"
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
