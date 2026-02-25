import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { useAppStore } from '../../data/store';
import type { Transaction } from '../../data/types';
import { CASHFLOW_SHEET_LINE_LABELS, type CashflowSheetLineId } from '../../data/types';
import { getYearMondayWeeks, findWeekForDate, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import {
  SETTLEMENT_COLUMNS, SETTLEMENT_COLUMN_GROUPS,
  exportSettlementCsv, parseSettlementCsv,
  getCashflowLineLabelForExport, parseCashflowLineLabel,
  CASHFLOW_LINE_OPTIONS,
} from '../../platform/settlement-csv';
import { parseCsv, triggerDownload } from '../../platform/csv-utils';

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

// ── Types ──

interface WeekBucket {
  week: MonthMondayWeek;
  transactions: Transaction[];
  collapsed: boolean;
}

interface Props {
  projectId: string;
  projectName: string;
}

// ── Main Component ──

export function SettlementLedgerPage({ projectId, projectName }: Props) {
  const { transactions, addTransaction, updateTransaction, ledgers } = useAppStore();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importPreview, setImportPreview] = useState<{
    transactions: Transaction[];
    errors: { row: number; message: string }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All weeks for the year
  const yearWeeks = useMemo(() => getYearMondayWeeks(year), [year]);

  // Filter transactions for this project + year
  const projectTxs = useMemo(() => {
    const yearStr = String(year);
    return transactions.filter(
      (tx) => tx.projectId === projectId && tx.dateTime.startsWith(yearStr),
    );
  }, [transactions, projectId, year]);

  // Find default ledger for project
  const defaultLedgerId = useMemo(() => {
    const ledger = ledgers.find((l) => l.projectId === projectId);
    return ledger?.id || `l-${projectId}`;
  }, [ledgers, projectId]);

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
    const result = parseSettlementCsv(matrix, projectId, defaultLedgerId);

    // Assign weekCodes based on date
    for (const tx of result.valid) {
      const d = tx.dateTime.slice(0, 10);
      const w = findWeekForDate(d, yearWeeks);
      if (w) tx.weekCode = w.label;
    }

    setImportPreview({ transactions: result.valid, errors: result.errors });
  }, [projectId, defaultLedgerId, yearWeeks]);

  const confirmImport = useCallback(() => {
    if (!importPreview) return;
    for (const tx of importPreview.transactions) {
      // Check if transaction with same ID already exists
      const existing = transactions.find((t) => t.id === tx.id);
      if (existing) {
        updateTransaction(tx.id, tx);
      } else {
        addTransaction(tx);
      }
    }
    setImportPreview(null);
  }, [importPreview, transactions, addTransaction, updateTransaction]);

  // ── Inline edit handler ──
  const handleUpdateTx = useCallback(
    (txId: string, updates: Partial<Transaction>) => {
      updateTransaction(txId, updates);
    },
    [updateTransaction],
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
              const startRow = globalRowNum + 1;

              // Accumulate row numbers even when collapsed
              const rows = txs.map((tx, i) => {
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
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Import Preview Dialog ── */}
      <AlertDialog open={importPreview !== null} onOpenChange={(open) => { if (!open) setImportPreview(null); }}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>CSV 업로드 확인</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  유효 거래: <Badge variant="default">{importPreview?.transactions.length ?? 0}건</Badge>
                  {(importPreview?.errors.length ?? 0) > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      오류 {importPreview?.errors.length}건
                    </Badge>
                  )}
                </p>
                {importPreview?.errors.slice(0, 5).map((e, i) => (
                  <p key={i} className="text-xs text-destructive">
                    행 {e.row}: {e.message}
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  {importPreview?.transactions.length}건의 거래가 추가/업데이트됩니다.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>확인</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
}

function WeekSection({ week, txRows, collapsed, txCount, onToggle, onUpdateTx }: WeekSectionProps) {
  const colCount = SETTLEMENT_COLUMNS.length;

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
}

function TransactionRow({ tx, rowNum, weekLabel, onUpdate }: TransactionRowProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const debouncedUpdate = useCallback(
    (updates: Partial<Transaction>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUpdate(updates), 1200);
    },
    [onUpdate],
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
        className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[60px]"
        onBlur={(e) => {
          if (e.target.value !== (value || '')) {
            debouncedUpdate({ [field]: e.target.value } as Partial<Transaction>);
          }
        }}
      />
    </td>
  );

  const numberCell = (value: number | undefined, nested?: boolean) => (
    <td className="px-1 py-0.5 border-b border-r text-right tabular-nums">
      <span className="text-[11px]">{fmt(value)}</span>
    </td>
  );

  const boolCell = (value: boolean | undefined, field: keyof Transaction) => (
    <td className="px-1 py-0.5 border-b border-r text-center">
      <Checkbox
        checked={!!value}
        onCheckedChange={(checked) =>
          onUpdate({ [field]: !!checked } as Partial<Transaction>)
        }
        className="h-3.5 w-3.5"
      />
    </td>
  );

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      {/* 작성자 */}
      {textCell(tx.author, 'author')}
      {/* No. */}
      <td className="px-1 py-0.5 border-b border-r text-center text-[11px] text-muted-foreground">
        {rowNum}
      </td>
      {/* 거래일시 */}
      <td className="px-1 py-0.5 border-b border-r">
        <input
          type="date"
          defaultValue={tx.dateTime?.slice(0, 10) || ''}
          className="bg-transparent outline-none text-[11px] px-0.5"
          onBlur={(e) => {
            if (e.target.value && e.target.value !== tx.dateTime?.slice(0, 10)) {
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
          className="bg-transparent outline-none text-[11px] w-full cursor-pointer"
          onChange={(e) => onUpdate({ method: e.target.value as Transaction['method'] })}
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
          className="bg-transparent outline-none text-[11px] w-full cursor-pointer min-w-[100px]"
          onChange={(e) => onUpdate({ cashflowLabel: e.target.value })}
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
      {textCell(tx.evidenceCompletedDesc, 'evidenceCompletedDesc')}
      {/* 사업팀: 준비필요자료 */}
      {textCell(tx.evidencePendingDesc, 'evidencePendingDesc')}
      {/* 정산지원: 증빙자료 드라이브 */}
      {textCell(tx.evidenceDriveLink, 'evidenceDriveLink')}
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
