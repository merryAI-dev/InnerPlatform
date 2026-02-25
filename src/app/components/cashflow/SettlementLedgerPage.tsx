import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Plus, Save, Send, Upload, X, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import type { Transaction, TransactionState } from '../../data/types';
import { getYearMondayWeeks, findWeekForDate, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import {
  SETTLEMENT_COLUMNS, SETTLEMENT_COLUMN_GROUPS,
  exportSettlementCsv,
  CASHFLOW_LINE_OPTIONS,
  normalizeMatrixToImportRows, createEmptyImportRow, importRowToTransaction,
  type ImportRow,
} from '../../platform/settlement-csv';
import { parseCsv, triggerDownload } from '../../platform/csv-utils';
import { computeEvidenceStatus, computeEvidenceSummary, isValidDriveUrl } from '../../platform/evidence-helpers';

// ── Helpers ──

const fmt = (n: number | undefined) =>
  n != null && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';

const METHOD_LABELS: Record<string, string> = {
  BANK_TRANSFER: '계좌이체',
  CARD: '법인카드',
  CASH: '현금',
  CHECK: '수표',
  OTHER: '기타',
};

const METHOD_OPTIONS = Object.entries(METHOD_LABELS).map(([v, l]) => ({ value: v, label: l }));

const TX_STATE_BADGE: Record<TransactionState, { label: string; cls: string }> = {
  DRAFT: { label: '작성중', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  SUBMITTED: { label: '제출', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  APPROVED: { label: '승인', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  REJECTED: { label: '반려', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

function isEditable(state: TransactionState | undefined): boolean {
  return !state || state === 'DRAFT' || state === 'REJECTED';
}

// ── Types ──

interface WeekBucket {
  week: MonthMondayWeek;
  transactions: Transaction[];
  collapsed: boolean;
}

export interface SettlementLedgerProps {
  projectId: string;
  projectName: string;
  transactions: Transaction[];
  defaultLedgerId: string;
  onAddTransaction: (tx: Transaction) => void;
  onUpdateTransaction: (id: string, updates: Partial<Transaction>) => void;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void;
  /** Current user name for audit trail */
  currentUserName?: string;
  userRole?: 'pm' | 'admin';
}

// ── Main Component ──

export function SettlementLedgerPage({
  projectId,
  projectName,
  transactions: allTransactions,
  defaultLedgerId,
  onAddTransaction,
  onUpdateTransaction,
  onSubmitWeek,
  onChangeTransactionState,
  currentUserName = 'PM',
  userRole = 'pm',
}: SettlementLedgerProps) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All weeks for the year
  const yearWeeks = useMemo(() => getYearMondayWeeks(year), [year]);

  // Filter transactions for this project + year
  const projectTxs = useMemo(() => {
    const yearStr = String(year);
    return allTransactions.filter(
      (tx) => tx.projectId === projectId && tx.dateTime.startsWith(yearStr),
    );
  }, [allTransactions, projectId, year]);

  // Group transactions by week
  const weekBuckets: WeekBucket[] = useMemo(() => {
    const txByWeek = new Map<string, Transaction[]>();
    for (const w of yearWeeks) txByWeek.set(w.label, []);

    for (const tx of projectTxs) {
      const d = tx.dateTime.slice(0, 10);
      const w = findWeekForDate(d, yearWeeks);
      const key = w?.label || '__unmatched__';
      if (!txByWeek.has(key)) txByWeek.set(key, []);
      txByWeek.get(key)!.push(tx);
    }

    return yearWeeks.map((week) => ({
      week,
      transactions: (txByWeek.get(week.label) || []).sort((a, b) =>
        a.dateTime.localeCompare(b.dateTime),
      ),
      collapsed: collapsedWeeks.has(week.label),
    }));
  }, [yearWeeks, projectTxs, collapsedWeeks]);

  const resolveWeekLabelFromDate = useCallback((dateStr: string): string => {
    if (!dateStr) return '';
    const y = Number.parseInt(dateStr.slice(0, 4), 10);
    if (!Number.isFinite(y)) return '';
    const weeksForYear = getYearMondayWeeks(y);
    return findWeekForDate(dateStr, weeksForYear)?.label || '';
  }, []);

  // Auto-collapse empty weeks on year change
  useEffect(() => {
    const empty = new Set<string>();
    for (const b of weekBuckets) {
      if (b.transactions.length === 0) empty.add(b.week.label);
    }
    setCollapsedWeeks(empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, projectTxs.length]);

  const toggleWeek = useCallback((label: string) => {
    setCollapsedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsedWeeks(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsedWeeks(new Set(yearWeeks.map((w) => w.label)));
  }, [yearWeeks]);

  // ── CSV Download ──
  const handleDownload = useCallback(() => {
    const csv = exportSettlementCsv(projectTxs, yearWeeks);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `정산대장_${projectName}_${year}.csv`);
  }, [projectTxs, yearWeeks, projectName, year]);

  // ── CSV Upload ──
  const handleFileUpload = useCallback(async (file: File) => {
    const text = await file.text();
    const matrix = parseCsv(text);
    const rows = normalizeMatrixToImportRows(matrix);

    // Validate each row to show errors
    for (const row of rows) {
      const result = importRowToTransaction(row, projectId, defaultLedgerId, 0);
      row.error = result.error;
    }

    setImportRows(rows);
  }, [projectId, defaultLedgerId]);

  const handleImportSave = useCallback(() => {
    if (!importRows) return;
    let savedCount = 0;
    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      const result = importRowToTransaction(row, projectId, defaultLedgerId, i);
      if (result.transaction) {
        const tx = result.transaction;
        // Assign weekCode
        const d = tx.dateTime.slice(0, 10);
        tx.weekCode = resolveWeekLabelFromDate(d);
        // Check for existing
        const existing = allTransactions.find((t) => t.id === tx.id);
        if (existing) {
          onUpdateTransaction(tx.id, tx);
        } else {
          onAddTransaction(tx);
        }
        savedCount++;
      }
    }
    setImportRows(null);
  }, [importRows, projectId, defaultLedgerId, allTransactions, onAddTransaction, onUpdateTransaction, resolveWeekLabelFromDate]);

  // ── Inline edit handler with audit trail ──
  const handleUpdateTx = useCallback(
    (txId: string, updates: Partial<Transaction>) => {
      const existing = allTransactions.find((t) => t.id === txId);
      if (!existing) {
        onUpdateTransaction(txId, updates);
        return;
      }

      const normalizedUpdates: Partial<Transaction> = { ...updates };
      if (typeof normalizedUpdates.dateTime === 'string') {
        normalizedUpdates.weekCode = resolveWeekLabelFromDate(normalizedUpdates.dateTime.slice(0, 10));
      }

      // Build edit history entries for changed fields
      const now = new Date().toISOString();
      const newEntries: NonNullable<Transaction['editHistory']> = [];
      for (const [key, newValue] of Object.entries(normalizedUpdates)) {
        const oldValue = (existing as Record<string, unknown>)[key];
        if (oldValue !== newValue) {
          newEntries.push({
            field: key,
            before: oldValue,
            after: newValue,
            editedBy: currentUserName,
            editedAt: now,
          });
        }
      }

      const enhancedUpdates: Partial<Transaction> = {
        ...normalizedUpdates,
        updatedAt: now,
        updatedBy: currentUserName,
      };

      if (newEntries.length > 0) {
        enhancedUpdates.editHistory = [
          ...(existing.editHistory || []),
          ...newEntries,
        ];
      }

      onUpdateTransaction(txId, enhancedUpdates);
    },
    [allTransactions, onUpdateTransaction, currentUserName, resolveWeekLabelFromDate],
  );

  // Row numbering
  let globalRowNum = 0;

  const totalCount = projectTxs.length;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[60px] text-center">{year}년</span>
          <Button variant="outline" size="sm" onClick={() => setYear((y) => y + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Badge variant="secondary" className="ml-2 text-[11px]">
            {totalCount}건
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>
            전체 펼치기
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            전체 접기
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            CSV 다운로드
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            CSV 업로드
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file);
              e.currentTarget.value = '';
            }}
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="relative w-full overflow-x-auto border rounded-lg">
        <table className="w-full text-[11px] border-collapse">
          {/* Group header row */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 dark:bg-slate-800">
              {SETTLEMENT_COLUMN_GROUPS.map((g) => (
                <th
                  key={g.name}
                  colSpan={g.colSpan}
                  className="px-2 py-1.5 text-center font-bold border-b border-r text-[10px] text-slate-600 dark:text-slate-300 uppercase tracking-wide"
                >
                  {g.name}
                </th>
              ))}
            </tr>
            {/* Column header row */}
            <tr className="bg-slate-50 dark:bg-slate-900">
              {SETTLEMENT_COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className={`px-2 py-1.5 font-medium border-b border-r whitespace-nowrap text-[10px] ${
                    col.format === 'number' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.csvHeader}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekBuckets.map((bucket) => {
              const { week, transactions: txs, collapsed } = bucket;
              const weekTxCount = txs.length;

              // Accumulate row numbers even when collapsed
              const rows = txs.map((tx) => {
                globalRowNum++;
                return { tx, rowNum: globalRowNum };
              });

              return (
                <WeekSection
                  key={week.label}
                  week={week}
                  txRows={rows}
                  collapsed={collapsed}
                  txCount={weekTxCount}
                  onToggle={() => toggleWeek(week.label)}
                  onUpdateTx={handleUpdateTx}
                  onSubmitWeek={onSubmitWeek}
                  onChangeTransactionState={onChangeTransactionState}
                  userRole={userRole}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Import Editor (editable preview) ── */}
      {importRows !== null && (
        <ImportEditor
          rows={importRows}
          onChange={setImportRows}
          onSave={handleImportSave}
          onCancel={() => setImportRows(null)}
          projectId={projectId}
          defaultLedgerId={defaultLedgerId}
        />
      )}
    </div>
  );
}

// ── Week Section ──

interface WeekSectionProps {
  week: MonthMondayWeek;
  txRows: { tx: Transaction; rowNum: number }[];
  collapsed: boolean;
  txCount: number;
  onToggle: () => void;
  onUpdateTx: (txId: string, updates: Partial<Transaction>) => void;
  onSubmitWeek?: (input: {
    weekLabel: string;
    yearMonth: string;
    weekNo: number;
    txIds: string[];
  }) => void | Promise<void>;
  onChangeTransactionState?: (txId: string, newState: TransactionState, reason?: string) => void;
  userRole?: 'pm' | 'admin';
}

function WeekSection({ week, txRows, collapsed, txCount, onToggle, onUpdateTx, onSubmitWeek, onChangeTransactionState, userRole }: WeekSectionProps) {
  const [submitting, setSubmitting] = useState(false);
  const colCount = SETTLEMENT_COLUMNS.length;
  const draftTxIds = txRows.filter(({ tx }) => tx.state === 'DRAFT').map(({ tx }) => tx.id);
  const hasDrafts = draftTxIds.length > 0 && userRole === 'pm';
  const evSummary = txRows.length > 0 ? computeEvidenceSummary(txRows.map(({ tx }) => tx)) : null;

  return (
    <>
      {/* Week header row */}
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
              {week.weekStart} ~ {week.weekEnd}
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
      {/* Transaction rows */}
      {!collapsed &&
        txRows.map(({ tx, rowNum }) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            rowNum={rowNum}
            weekLabel={week.label}
            onUpdate={(updates) => onUpdateTx(tx.id, updates)}
            onChangeState={onChangeTransactionState}
            userRole={userRole}
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

// ── Transaction Row ──

interface TransactionRowProps {
  tx: Transaction;
  rowNum: number;
  weekLabel: string;
  onUpdate: (updates: Partial<Transaction>) => void;
  onChangeState?: (txId: string, newState: TransactionState, reason?: string) => void;
  userRole?: 'pm' | 'admin';
}

function TransactionRow({ tx, rowNum, weekLabel, onUpdate, onChangeState, userRole }: TransactionRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const locked = !isEditable(tx.state);

  const debouncedUpdate = useCallback(
    (updates: Partial<Transaction>) => {
      if (locked) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUpdate(updates), 1200);
    },
    [onUpdate, locked],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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

  const boolCell = (value: boolean | undefined, field: keyof Transaction) => (
    <td className="px-1 py-0.5 border-b border-r text-center">
      <Checkbox
        checked={!!value}
        disabled={locked}
        onCheckedChange={(checked) => {
          if (!locked) onUpdate({ [field]: !!checked } as Partial<Transaction>);
        }}
        className="h-3.5 w-3.5"
      />
    </td>
  );

  const stateBadge = TX_STATE_BADGE[tx.state] || TX_STATE_BADGE.DRAFT;

  return (
    <tr className={`hover:bg-muted/30 transition-colors ${locked ? 'opacity-80' : ''}`}>
      {/* 작성자 + 상태배지 */}
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
              onClick={() => onChangeState(tx.id, 'DRAFT')}
            >
              수정
            </button>
          )}
        </div>
      </td>
      {/* No. */}
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {rowNum}
      </td>
      {/* 거래일시 */}
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
      {/* 해당 주차 */}
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {weekLabel}
      </td>
      {/* 지출구분 */}
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={tx.method}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => { if (!locked) onUpdate({ method: e.target.value as Transaction['method'] }); }}
        >
          {METHOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </td>
      {/* 비목 */}
      {textCell(tx.budgetCategory, 'budgetCategory')}
      {/* 세목 */}
      {textCell(tx.budgetSubCategory, 'budgetSubCategory')}
      {/* 세세목 */}
      {textCell(tx.budgetSubSubCategory, 'budgetSubSubCategory')}
      {/* cashflow항목 */}
      <td className="px-1 py-0.5 border-b border-r">
        <select
          defaultValue={tx.cashflowLabel || ''}
          disabled={locked}
          className={`bg-transparent outline-none text-[11px] w-full cursor-pointer min-w-[100px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onChange={(e) => { if (!locked) onUpdate({ cashflowLabel: e.target.value }); }}
        >
          <option value="">-</option>
          {CASHFLOW_LINE_OPTIONS.map((o) => (
            <option key={o.value} value={o.label}>{o.label}</option>
          ))}
        </select>
      </td>
      {/* 통장잔액 */}
      {numberCell(tx.amounts?.balanceAfter)}
      {/* 통장에 찍힌 입/출금액 */}
      {numberCell(tx.amounts?.bankAmount)}
      {/* 입금합계: 입금액 */}
      {numberCell(tx.amounts?.depositAmount)}
      {/* 입금합계: 매입부가세 반환 */}
      {numberCell(tx.amounts?.vatRefund)}
      {/* 출금합계: 사업비 사용액 */}
      {numberCell(tx.amounts?.expenseAmount)}
      {/* 출금합계: 매입부가세 */}
      {numberCell(tx.amounts?.vatIn)}
      {/* 사업팀: 지급처 */}
      {textCell(tx.counterparty, 'counterparty')}
      {/* 사업팀: 상세 적요 */}
      {textCell(tx.memo, 'memo', 'min-w-[150px]')}
      {/* 사업팀: 필수증빙자료 리스트 */}
      {textCell(tx.evidenceRequiredDesc, 'evidenceRequiredDesc')}
      {/* 사업팀: 실제 구비 완료된 증빙자료 리스트 */}
      <td className="px-1 py-0.5 border-b border-r">
        <input
          type="text"
          defaultValue={tx.evidenceCompletedDesc || ''}
          disabled={locked}
          className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
          onBlur={(e) => {
            if (!locked && e.target.value !== (tx.evidenceCompletedDesc || '')) {
              const updatedTx = { ...tx, evidenceCompletedDesc: e.target.value };
              const newStatus = computeEvidenceStatus(updatedTx);
              debouncedUpdate({ evidenceCompletedDesc: e.target.value, evidenceStatus: newStatus });
            }
          }}
        />
      </td>
      {/* 사업팀: 준비필요자료 */}
      {textCell(tx.evidencePendingDesc, 'evidencePendingDesc')}
      {/* 정산지원: 증빙자료 드라이브 */}
      <td className="px-1 py-0.5 border-b border-r">
        <div className="flex items-center gap-1">
          <input
            type="text"
            defaultValue={tx.evidenceDriveLink || ''}
            disabled={locked}
            placeholder="Drive URL"
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
      {/* 정산지원: 준비 필요자료 */}
      {textCell(tx.supportPendingDocs, 'supportPendingDocs')}
      {/* 도담: e나라 등록 */}
      {textCell(tx.eNaraRegistered, 'eNaraRegistered')}
      {/* 도담: e나라 집행 */}
      {textCell(tx.eNaraExecuted, 'eNaraExecuted')}
      {/* 도담: 부가세 지결 완료여부 */}
      {boolCell(tx.vatSettlementDone, 'vatSettlementDone')}
      {/* 도담: 최종완료 */}
      {boolCell(tx.settlementComplete, 'settlementComplete')}
      {/* 비고 */}
      {textCell(tx.settlementNote, 'settlementNote')}
    </tr>
  );
}

// ── Import Editor (editable CSV preview) ──

function ImportEditor({
  rows,
  onChange,
  onSave,
  onCancel,
  projectId,
  defaultLedgerId,
}: {
  rows: ImportRow[];
  onChange: (rows: ImportRow[]) => void;
  onSave: () => void;
  onCancel: () => void;
  projectId: string;
  defaultLedgerId: string;
}) {
  const errorCount = rows.filter((r) => r.error).length;
  const validCount = rows.length - errorCount;

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[colIdx] = value;
        const updated: ImportRow = { ...r, cells };
        // Re-validate
        const result = importRowToTransaction(updated, projectId, defaultLedgerId, i);
        updated.error = result.error;
        return updated;
      });
      onChange(next);
    },
    [rows, onChange, projectId, defaultLedgerId],
  );

  const addRow = useCallback(() => {
    const newRow = createEmptyImportRow();
    // Set No. column
    const noIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.');
    if (noIdx >= 0) newRow.cells[noIdx] = String(rows.length + 1);
    newRow.error = '거래일시 또는 금액이 비어 있습니다';
    onChange([...rows, newRow]);
  }, [rows, onChange]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      onChange(rows.filter((_, i) => i !== rowIdx));
    },
    [rows, onChange],
  );

  return (
    <div className="fixed inset-0 z-50 bg-background/95 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold">CSV 가져오기 편집</h3>
          <Badge variant="default" className="text-[10px]">{validCount}건 유효</Badge>
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">{errorCount}건 오류</Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            셀을 직접 수정하거나 행을 추가할 수 있습니다
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" />
            행 추가
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onCancel}>
            취소
          </Button>
          <Button
            size="sm"
            className="h-7 text-[11px] gap-1"
            onClick={onSave}
            disabled={validCount === 0}
          >
            <Save className="h-3.5 w-3.5" />
            {validCount}건 저장
          </Button>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Group header */}
            <tr className="bg-slate-100 dark:bg-slate-800">
              <th className="px-1 py-1 border-b border-r text-center text-[9px] w-8" />
              {SETTLEMENT_COLUMN_GROUPS.map((g) => (
                <th
                  key={g.name}
                  colSpan={g.colSpan}
                  className="px-2 py-1 text-center font-bold border-b border-r text-[10px] text-slate-600 dark:text-slate-300"
                >
                  {g.name}
                </th>
              ))}
            </tr>
            {/* Column header */}
            <tr className="bg-slate-50 dark:bg-slate-900">
              <th className="px-1 py-1 border-b border-r text-[9px] w-8" />
              {SETTLEMENT_COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className="px-1.5 py-1 font-medium border-b border-r whitespace-nowrap text-[10px] text-left"
                >
                  {col.csvHeader}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <ImportEditorRow
                key={row.tempId}
                row={row}
                rowIdx={rowIdx}
                onCellChange={(colIdx, value) => updateCell(rowIdx, colIdx, value)}
                onRemove={() => removeRow(rowIdx)}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={SETTLEMENT_COLUMNS.length + 1}
                  className="px-4 py-8 text-center text-[12px] text-muted-foreground"
                >
                  CSV 데이터가 없습니다. 행을 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportEditorRow({
  row,
  rowIdx,
  onCellChange,
  onRemove,
}: {
  row: ImportRow;
  rowIdx: number;
  onCellChange: (colIdx: number, value: string) => void;
  onRemove: () => void;
}) {
  const hasError = Boolean(row.error);

  return (
    <tr className={`${hasError ? 'bg-red-50/60 dark:bg-red-950/20' : 'hover:bg-muted/30'} transition-colors`}>
      {/* Row controls */}
      <td className="px-0.5 py-0.5 border-b border-r text-center align-middle w-8">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[9px] text-muted-foreground">{rowIdx + 1}</span>
          {hasError && (
            <span title={row.error} className="text-red-500">
              <AlertTriangle className="h-3 w-3" />
            </span>
          )}
          <button
            onClick={onRemove}
            className="text-muted-foreground/40 hover:text-destructive transition-colors"
            title="행 삭제"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </td>
      {/* Data cells */}
      {SETTLEMENT_COLUMNS.map((col, colIdx) => {
        const isReadOnly = col.csvHeader === 'No.' || col.csvHeader === '해당 주차';
        return (
          <td key={colIdx} className="px-0.5 py-0.5 border-b border-r">
            {isReadOnly ? (
              <span className="text-[10px] text-muted-foreground px-1">
                {row.cells[colIdx]}
              </span>
            ) : (
              <input
                type="text"
                defaultValue={row.cells[colIdx]}
                className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[50px] ${
                  hasError && colIdx === SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시') && !row.cells[colIdx]
                    ? 'ring-1 ring-red-300 rounded'
                    : ''
                }`}
                onBlur={(e) => {
                  if (e.target.value !== row.cells[colIdx]) {
                    onCellChange(colIdx, e.target.value);
                  }
                }}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}
