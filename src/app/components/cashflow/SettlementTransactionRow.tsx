import { ExternalLink, Loader2, Plus, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Transaction, TransactionState } from '../../data/types';
import {
  computeEvidenceStatus,
  isValidDriveUrl,
  resolveEvidenceCompletedDesc,
  resolveEvidenceCompletedManualDesc,
} from '../../platform/evidence-helpers';
import { buildDriveTransactionFolderName } from '../../platform/drive-evidence';
import { CASHFLOW_LINE_OPTIONS } from '../../platform/settlement-csv';
import {
  findLatestFieldEdit,
  formatCommentTime,
  fmt,
  METHOD_OPTIONS,
  normalizeMethodValue,
  TX_STATE_BADGE,
  isEditable,
} from '../../platform/settlement-grid-helpers';
import { parseNumber } from '../../platform/csv-utils';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';

export interface TransactionRowProps {
  tx: Transaction;
  rowNum: number;
  weekLabel: string;
  onUpdate: (updates: Partial<Transaction>) => void | Promise<void>;
  onProvisionEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onSyncEvidenceDrive?: (tx: Transaction) => void | Promise<unknown>;
  onChangeState?: (txId: string, newState: TransactionState, reason?: string) => void | Promise<void>;
  userRole?: 'pm' | 'admin';
  allowEditSubmitted?: boolean;
}

export function SettlementTransactionRow({
  tx,
  rowNum,
  weekLabel,
  onUpdate,
  onProvisionEvidenceDrive,
  onSyncEvidenceDrive,
  onChangeState,
  userRole,
  allowEditSubmitted = false,
}: TransactionRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const locked = allowEditSubmitted ? tx.state === 'APPROVED' : !isEditable(tx.state);
  const [driveAction, setDriveAction] = useState<'' | 'provision' | 'sync'>('');

  const debouncedUpdate = useCallback(
    (updates: Partial<Transaction>) => {
      if (locked) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void Promise.resolve(onUpdate(updates)).catch((error) => {
          console.error('[SettlementLedger] update transaction failed:', error);
        });
      }, 1200);
    },
    [onUpdate, locked],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const autoCompletedDesc = tx.evidenceAutoListedDesc || '';
  const manualCompletedDesc = resolveEvidenceCompletedManualDesc(tx);
  const effectiveCompletedDesc = resolveEvidenceCompletedDesc(tx);
  const expenseAudit = findLatestFieldEdit(tx, 'amounts.expenseAmount');
  const vatInAudit = findLatestFieldEdit(tx, 'amounts.vatIn');
  const suggestedFolderName = tx.evidenceDriveFolderName || buildDriveTransactionFolderName(tx);
  const driveStatusLabel = tx.evidenceDriveSyncStatus === 'UPLOADED'
    ? '업로드됨'
    : tx.evidenceDriveSyncStatus === 'SYNCED'
      ? '동기화됨'
      : '';

  const runDriveAction = useCallback(async (
    action: 'provision' | 'sync',
    handler?: (targetTx: Transaction) => void | Promise<unknown>,
  ) => {
    if (!handler || driveAction) return;
    setDriveAction(action);
    try {
      await handler(tx);
    } catch (error) {
      console.error(`[SettlementLedger] evidence drive ${action} failed:`, error);
    } finally {
      setDriveAction('');
    }
  }, [driveAction, tx]);

  const textCell = (
    value: string | undefined,
    field: keyof Transaction,
    className?: string,
  ) => (
    <td className={`px-1 py-0.5 border-b border-r ${className || ''}`}>
      <input
        type="text"
        defaultValue={value || ''}
        disabled={locked}
        className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
        onBlur={(e) => {
          if (!locked && e.target.value !== (value || '')) {
            debouncedUpdate({ [field]: e.target.value } as Partial<Transaction>);
          }
        }}
      />
    </td>
  );

  const numberCell = (value: number | undefined) => (
    <td className="px-1 py-0.5 border-b border-r text-right tabular-nums">
      <span className="text-[11px]">{fmt(value)}</span>
    </td>
  );

  const expenseAmountCell = (value: number | undefined) => (
    <td className="px-1 py-0.5 border-b border-r text-right tabular-nums align-top">
      <div className="space-y-0.5">
        <input
          key={`expense-${tx.id}-${value ?? ''}`}
          type="text"
          defaultValue={fmt(value)}
          disabled={locked}
          className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 text-right ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (locked) return;
            const nextAmount = parseNumber(e.target.value) ?? 0;
            if (nextAmount !== (value ?? 0)) {
              void Promise.resolve(onUpdate({
                amounts: {
                  ...tx.amounts,
                  expenseAmount: nextAmount,
                },
              })).catch((error) => {
                console.error('[SettlementLedger] update transaction failed:', error);
              });
            }
            e.target.value = fmt(nextAmount);
          }}
        />
        {expenseAudit && (
          <div className="text-[9px] leading-tight text-muted-foreground">
            최종 수정 {expenseAudit.editedBy} · {formatCommentTime(expenseAudit.editedAt)}
          </div>
        )}
      </div>
    </td>
  );

  const vatInCell = (value: number | undefined) => (
    <td className="px-1 py-0.5 border-b border-r text-right tabular-nums align-top">
      <div className="space-y-0.5">
        <input
          key={`vatIn-${tx.id}-${value ?? ''}`}
          type="text"
          defaultValue={fmt(value)}
          disabled={locked}
          className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 text-right ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (locked) return;
            const nextAmount = parseNumber(e.target.value) ?? 0;
            if (nextAmount !== (value ?? 0)) {
              void Promise.resolve(onUpdate({
                amounts: {
                  ...tx.amounts,
                  vatIn: nextAmount,
                },
              })).catch((error) => {
                console.error('[SettlementLedger] update transaction failed:', error);
              });
            }
            e.target.value = fmt(nextAmount);
          }}
        />
        {vatInAudit && (
          <div className="text-[9px] leading-tight text-muted-foreground">
            최종 수정 {vatInAudit.editedBy} · {formatCommentTime(vatInAudit.editedAt)}
          </div>
        )}
      </div>
    </td>
  );

  const boolCell = (value: boolean | undefined, field: keyof Transaction) => (
    <td className="px-1 py-0.5 border-b border-r text-center">
      <Checkbox
        checked={!!value}
        disabled={locked}
        onCheckedChange={(checked) => {
          if (!locked) {
            void Promise.resolve(onUpdate({ [field]: !!checked } as Partial<Transaction>)).catch((error) => {
              console.error('[SettlementLedger] update transaction failed:', error);
            });
          }
        }}
        className="h-3.5 w-3.5"
      />
    </td>
  );

  const stateBadge = TX_STATE_BADGE[tx.state] || TX_STATE_BADGE.DRAFT;

  return (
    <tr className={`hover:bg-muted/30 transition-colors ${locked ? 'opacity-80' : ''}`}>
      <td className={`px-1 py-0.5 border-b border-r`}>
        <div className="flex items-center gap-1">
          <input
            type="text"
            defaultValue={tx.author || ''}
            disabled={locked}
            className={`flex-1 bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[40px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== (tx.author || '')) {
                debouncedUpdate({ author: e.target.value });
              }
            }}
          />
          <span className={`shrink-0 inline-flex items-center h-4 px-1.5 rounded-full text-[8px] font-bold ${stateBadge.cls}`}>
            {stateBadge.label}
          </span>
          {tx.state === 'REJECTED' && tx.rejectedReason && (
            <span className="shrink-0 text-[8px] text-red-500 truncate max-w-[80px]" title={tx.rejectedReason}>
              ({tx.rejectedReason})
            </span>
          )}
          {tx.state === 'REJECTED' && userRole === 'pm' && onChangeState && (
            <button
              className="shrink-0 text-[8px] text-blue-600 hover:underline"
              onClick={() => {
                void Promise.resolve(onChangeState(tx.id, 'DRAFT')).catch((error) => {
                  console.error('[SettlementLedger] change transaction state failed:', error);
                });
              }}
            >
              수정
            </button>
          )}
        </div>
      </td>
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {rowNum}
      </td>
      <td className="px-1 py-0.5 border-b border-r">
        <input
          type="date"
          defaultValue={tx.dateTime?.slice(0, 10) || ''}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] px-0.5 ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (!locked && e.target.value && e.target.value !== tx.dateTime?.slice(0, 10)) {
              debouncedUpdate({ dateTime: e.target.value });
            }
          }}
        />
      </td>
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {weekLabel}
      </td>
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={normalizeMethodValue(tx.method)}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => {
            if (!locked) {
              void Promise.resolve(onUpdate({ method: e.target.value as Transaction['method'] })).catch((error) => {
                console.error('[SettlementLedger] update transaction failed:', error);
              });
            }
          }}
        >
          {METHOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      {textCell(tx.budgetCategory, 'budgetCategory')}
      {textCell(tx.budgetSubCategory, 'budgetSubCategory')}
      {textCell(tx.budgetSubSubCategory, 'budgetSubSubCategory')}
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={tx.cashflowLabel || ''}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer min-w-[100px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => {
            if (!locked) {
              void Promise.resolve(onUpdate({ cashflowLabel: e.target.value })).catch((error) => {
                console.error('[SettlementLedger] update transaction failed:', error);
              });
            }
          }}
        >
          <option value="">-</option>
          {CASHFLOW_LINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.label}>{o.label}</option>
          ))}
        </select>
      </td>
      {numberCell(tx.amounts?.balanceAfter)}
      {numberCell(tx.amounts?.bankAmount)}
      {numberCell(tx.amounts?.depositAmount)}
      {numberCell(tx.amounts?.vatRefund)}
      {expenseAmountCell(tx.amounts?.expenseAmount)}
      {vatInCell(tx.amounts?.vatIn)}
      {textCell(tx.counterparty, 'counterparty')}
      {textCell(tx.memo, 'memo', 'min-w-[150px]')}
      {textCell(tx.evidenceRequiredDesc, 'evidenceRequiredDesc')}
      <td className="px-1 py-0.5 border-b border-r align-top">
        <div className="min-w-[160px] space-y-1">
          <div
            className="rounded border border-dashed bg-muted/30 px-1 py-0.5 text-[10px]"
            title={autoCompletedDesc ? `드라이브 자동 집계: ${autoCompletedDesc}` : '동기화 후 드라이브 파일 기준으로 자동 집계됩니다.'}
          >
            <div className="text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">자동 집계</div>
            <div className="truncate">{autoCompletedDesc || '동기화 전'}</div>
          </div>
          <input
            key={`evidence-completed-manual-${tx.id}-${manualCompletedDesc}`}
            type="text"
            defaultValue={manualCompletedDesc}
            disabled={locked}
            placeholder="수기 보정(선택)"
            title={effectiveCompletedDesc ? `최종 반영: ${effectiveCompletedDesc}` : '수기 보정이 없으면 자동 집계 목록이 그대로 반영됩니다.'}
            className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] border rounded ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== manualCompletedDesc) {
                const nextManualDesc = e.target.value.trim();
                const updatedTx = {
                  ...tx,
                  evidenceCompletedManualDesc: nextManualDesc || undefined,
                  evidenceCompletedDesc: resolveEvidenceCompletedDesc({
                    ...tx,
                    evidenceCompletedManualDesc: nextManualDesc || undefined,
                  } as Transaction),
                };
                const newStatus = computeEvidenceStatus(updatedTx);
                debouncedUpdate({
                  evidenceCompletedManualDesc: nextManualDesc || undefined,
                  evidenceCompletedDesc: updatedTx.evidenceCompletedDesc,
                  evidenceStatus: newStatus,
                });
              }
            }}
          />
        </div>
      </td>
      {textCell(tx.evidencePendingDesc, 'evidencePendingDesc')}
      <td className="px-1 py-0.5 border-b border-r">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px] shrink-0"
            disabled={driveAction !== '' || !onProvisionEvidenceDrive}
            onClick={(e) => {
              e.stopPropagation();
              void runDriveAction('provision', onProvisionEvidenceDrive);
            }}
            title={`증빙 폴더 생성 · ${suggestedFolderName}`}
          >
            {driveAction === 'provision' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            생성
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[9px] shrink-0"
            disabled={driveAction !== '' || !onSyncEvidenceDrive}
            onClick={(e) => {
              e.stopPropagation();
              void runDriveAction('sync', onSyncEvidenceDrive);
            }}
            title="Drive 폴더 파일을 다시 읽어 완료 목록에 반영"
          >
            {driveAction === 'sync' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            동기화
          </Button>
          {driveStatusLabel && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${
                tx.evidenceDriveSyncStatus === 'UPLOADED'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-sky-200 bg-sky-50 text-sky-700'
              }`}
              title={tx.evidenceDriveSyncStatus === 'UPLOADED' ? '업로드는 완료됐고 목록 반영은 동기화 버튼에서 진행됩니다.' : 'Drive 폴더 파일 기준 완료 목록이 반영된 상태입니다.'}
            >
              {driveStatusLabel}
            </span>
          )}
          <input
            key={`evidence-drive-link-${tx.id}-${tx.evidenceDriveLink || ''}-${tx.evidenceDriveFolderId || ''}`}
            type="text"
            defaultValue={tx.evidenceDriveLink || ''}
            disabled={locked}
            placeholder=""
            title={`권장 폴더명: ${suggestedFolderName}`}
            className={`flex-1 bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== (tx.evidenceDriveLink || '')) {
                const updatedTx = { ...tx, evidenceDriveLink: e.target.value };
                const newStatus = computeEvidenceStatus(updatedTx);
                debouncedUpdate({ evidenceDriveLink: e.target.value, evidenceStatus: newStatus });
              }
            }}
          />
          {isValidDriveUrl(tx.evidenceDriveLink || '') && (
            <a
              href={tx.evidenceDriveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-blue-500 hover:text-blue-700"
              onClick={(e) => e.stopPropagation()}
              title="Google Drive에서 열기"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </td>
      {textCell(tx.supportPendingDocs, 'supportPendingDocs')}
      {textCell(tx.eNaraRegistered, 'eNaraRegistered')}
      {textCell(tx.eNaraExecuted, 'eNaraExecuted')}
      {boolCell(tx.vatSettlementDone, 'vatSettlementDone')}
      {boolCell(tx.settlementComplete, 'settlementComplete')}
      {textCell(tx.settlementNote, 'settlementNote')}
    </tr>
  );
}
