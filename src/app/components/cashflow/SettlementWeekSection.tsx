import { ChevronDown, ChevronRight, Send } from 'lucide-react';
import { useState } from 'react';
import type { Transaction, TransactionState } from '../../data/types';
import type { MonthMondayWeek } from '../../platform/cashflow-weeks';
import { computeEvidenceSummary } from '../../platform/evidence-helpers';
import { SETTLEMENT_COLUMNS } from '../../platform/settlement-csv';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SettlementTransactionRow } from './SettlementTransactionRow';

export interface WeekSectionProps {
  week: MonthMondayWeek;
  txRows: { tx: Transaction; rowNum: number }[];
  collapsed: boolean;
  txCount: number;
  onToggle: () => void;
  onUpdateTx: (txId: string, updates: Partial<Transaction>) => void | Promise<void>;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void | Promise<void>;
  userRole?: 'pm' | 'admin';
  allowEditSubmitted?: boolean;
}

export function SettlementWeekSection({
  week,
  txRows,
  collapsed,
  txCount,
  onToggle,
  onUpdateTx,
  onProvisionEvidenceDrive,
  onSyncEvidenceDrive,
  onSubmitWeek,
  onChangeTransactionState,
  userRole,
  allowEditSubmitted,
}: WeekSectionProps) {
  const [submitting, setSubmitting] = useState(false);
  const colCount = SETTLEMENT_COLUMNS.length;
  const draftTxIds = txRows.filter(({ tx }) => tx.state === 'DRAFT').map(({ tx }) => tx.id);
  const hasDrafts = draftTxIds.length > 0 && userRole === 'pm' && week.weekNo > 0;
  const evSummary = txRows.length > 0 ? computeEvidenceSummary(txRows.map(({ tx }) => tx)) : null;

  return (
    <>
      <tr
        className="bg-blue-50 dark:bg-blue-950 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900"
        onClick={onToggle}
      >
        <td colSpan={colCount} className="px-3 py-1.5 border-b">
          <div className="flex items-center gap-2">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-blue-600" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-blue-600" />
            )}
            <span className="font-bold text-[11px] text-blue-700 dark:text-blue-300">
              {week.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {week.weekStart ? `${week.weekStart} ~ ${week.weekEnd}` : '날짜 없음'}
            </span>
            <Badge
              variant={txCount > 0 ? 'default' : 'secondary'}
              className="text-[9px] h-4 px-1.5"
            >
              {txCount}건
            </Badge>
            {evSummary && txCount > 0 && (
              <span className="text-[9px] text-muted-foreground">
                증빙:
                {evSummary.complete > 0 && <span className="text-emerald-600 ml-1">완료 {evSummary.complete}</span>}
                {evSummary.partial > 0 && <span className="text-amber-600 ml-1">일부 {evSummary.partial}</span>}
                {evSummary.missing > 0 && <span className="text-rose-600 ml-1">미제출 {evSummary.missing}</span>}
              </span>
            )}
            {hasDrafts && onSubmitWeek && (
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[9px] gap-1 px-2 ml-auto border-amber-400 text-amber-700 hover:bg-amber-50"
                disabled={submitting}
                onClick={(e) => {
                  e.stopPropagation();
                  setSubmitting(true);
                  Promise.resolve(
                    onSubmitWeek({
                      weekLabel: week.label,
                      yearMonth: week.yearMonth,
                      weekNo: week.weekNo,
                      txIds: draftTxIds,
                    }),
                  )
                    .catch((err) => {
                      console.error('[SettlementLedger] submit week failed:', err);
                    })
                    .finally(() => setSubmitting(false));
                }}
              >
                <Send className="h-2.5 w-2.5" />
                {submitting ? '제출중...' : `제출 (${draftTxIds.length}건)`}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {!collapsed &&
        txRows.map(({ tx, rowNum }) => (
          <SettlementTransactionRow
            key={tx.id}
            tx={tx}
            rowNum={rowNum}
            weekLabel={week.label}
            onUpdate={(updates) => onUpdateTx(tx.id, updates)}
            onProvisionEvidenceDrive={onProvisionEvidenceDrive}
            onSyncEvidenceDrive={onSyncEvidenceDrive}
            onChangeState={onChangeTransactionState}
            userRole={userRole}
            allowEditSubmitted={allowEditSubmitted}
          />
        ))}
      {!collapsed && txCount === 0 && (
        <tr className="text-muted-foreground">
          <td colSpan={colCount} className="px-3 py-2 text-center text-[10px] border-b italic">
            이 주차에 등록된 거래가 없습니다
          </td>
        </tr>
      )}
    </>
  );
}
