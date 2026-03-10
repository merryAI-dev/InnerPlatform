import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download, ExternalLink, Plus, Save, Send, Upload, X } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BUDGET_CODE_BOOK } from '../../data/budget-data';
import { featureFlags } from '../../config/feature-flags';
import type { Transaction, TransactionState } from '../../data/types';
import { findWeekForDate, getYearMondayWeeks, type MonthMondayWeek } from '../../platform/cashflow-weeks';
import { parseCsv, parseDate, parseNumber, triggerDownload } from '../../platform/csv-utils';
import { computeEvidenceStatus, computeEvidenceSummary, isValidDriveUrl } from '../../platform/evidence-helpers';
import {
  composeSettlementNote,
  deriveSettlementAmounts,
  getPaymentMethodOptions,
  getSettlementProgressLabel,
  parseSettlementNote,
} from '../../platform/settlement-ledger.helpers';
import {
  buildImportRowsMatrix,
  CASHFLOW_LINE_OPTIONS,
  SETTLEMENT_COLUMNS, SETTLEMENT_COLUMN_GROUPS,
  createEmptyImportRow,
  exportImportRowsCsv,
  exportSettlementCsv,
  importRowToTransaction,
  normalizeMatrixToImportRows,
  renumberImportRows,
  transactionsToImportRows,
  type ImportRow,
} from '../../platform/settlement-csv';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

// ── Helpers ──

const fmt = (n: number | undefined) =>
  n != null && Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';

const METHOD_OPTIONS = getPaymentMethodOptions(!featureFlags.qaP0SettlementV1);
const SETTLEMENT_PROGRESS_OPTIONS = (['INCOMPLETE', 'COMPLETE'] as const).map((value) => ({
  value,
  label: getSettlementProgressLabel(value),
}));

function toCellTestId(rowIdx: number, header: string): string {
  const slug = header
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `settlement-${rowIdx + 1}-${slug}`;
}

type GridSlot = 'primary' | 'secondary';

function focusGridControl(rowIdx: number, colIdx: number, slot: GridSlot = 'primary'): boolean {
  if (rowIdx < 0 || colIdx < 0 || typeof document === 'undefined') return false;
  const selectors = [
    `[data-grid-row="${rowIdx}"][data-grid-col="${colIdx}"][data-grid-slot="${slot}"]`,
    slot === 'secondary' ? `[data-grid-row="${rowIdx}"][data-grid-col="${colIdx}"][data-grid-slot="primary"]` : '',
    `[data-grid-row="${rowIdx}"][data-grid-col="${colIdx}"]`,
  ].filter(Boolean);

  for (const selector of selectors) {
    const target = document.querySelector(selector) as HTMLElement | null;
    if (!target) continue;
    target.focus();
    if (target instanceof HTMLInputElement && !['checkbox', 'date', 'file'].includes(target.type)) {
      target.select();
    }
    return true;
  }

  return false;
}

function handleGridKeyDown(
  event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  rowIdx: number,
  colIdx: number,
  slot: GridSlot = 'primary',
) {
  if (event.key === 'Enter') {
    event.preventDefault();
    focusGridControl(rowIdx + (event.shiftKey ? -1 : 1), colIdx, slot);
    return;
  }

  if (event.currentTarget instanceof HTMLSelectElement) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusGridControl(rowIdx, colIdx - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusGridControl(rowIdx, colIdx + 1);
    }
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusGridControl(rowIdx - 1, colIdx, slot);
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusGridControl(rowIdx + 1, colIdx, slot);
    return;
  }

  const input = event.currentTarget;
  if (!['text', 'search', 'url', 'tel', 'password'].includes(input.type)) return;

  const selectionStart = input.selectionStart ?? 0;
  const selectionEnd = input.selectionEnd ?? 0;
  const length = input.value.length;

  if (event.key === 'ArrowLeft' && selectionStart === 0 && selectionEnd === 0) {
    event.preventDefault();
    focusGridControl(rowIdx, colIdx - 1);
  } else if (event.key === 'ArrowRight' && selectionStart === length && selectionEnd === length) {
    event.preventDefault();
    focusGridControl(rowIdx, colIdx + 1);
  }
}

function normalizeRowDateForFilter(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const head = raw.split(/[ T]/)[0] || raw;
  return parseDate(head) || parseDate(raw.slice(0, 10));
}

const TX_STATE_BADGE: Record<TransactionState, { label: string; cls: string }> = {
  DRAFT: { label: '작성중', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  SUBMITTED: { label: '제출', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  APPROVED: { label: '승인', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  REJECTED: { label: '반려', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
};

function isEditable(state: TransactionState | undefined): boolean {
  return !state || state === 'DRAFT' || state === 'REJECTED';
}

function resolveEvidenceRequiredDesc(
  map: Record<string, string> | undefined,
  budgetCode: string,
  subCode: string,
): string {
  if (!map) return '';
  return map[`${budgetCode}|${subCode}`] || map[subCode] || map[budgetCode] || '';
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
  evidenceRequiredMap?: Record<string, string>;
  onSaveEvidenceRequiredMap?: (map: Record<string, string>) => void | Promise<void>;
  sheetRows?: ImportRow[] | null;
  onSaveSheetRows?: (rows: ImportRow[]) => void | Promise<void>;
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
  evidenceRequiredMap,
  onSaveEvidenceRequiredMap,
  sheetRows,
  onSaveSheetRows,
  onSubmitWeek,
  onChangeTransactionState,
  currentUserName = 'PM',
  userRole = 'pm',
}: SettlementLedgerProps) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [viewMode, setViewMode] = useState<'sheet' | 'weekly'>('sheet');
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(new Set());
  const [importRows, setImportRows] = useState<ImportRow[] | null>(null);
  const [importDirty, setImportDirty] = useState(false);
  const [downloadStartDate, setDownloadStartDate] = useState('');
  const [downloadEndDate, setDownloadEndDate] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All weeks for the year
  const yearWeeks = useMemo(() => getYearMondayWeeks(year), [year]);

  // Filter transactions for this project + year
  const projectTxs = useMemo(() => {
    const yearStr = String(year);
    return allTransactions.filter(
      (tx) => tx.projectId === projectId && (!tx.dateTime || tx.dateTime.startsWith(yearStr)),
    );
  }, [allTransactions, projectId, year]);

  useEffect(() => {
    if (importDirty) return;
    if (sheetRows && sheetRows.length > 0) {
      setImportRows(renumberImportRows(sheetRows));
      return;
    }
    setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
  }, [projectTxs, yearWeeks, importDirty, sheetRows]);

  useEffect(() => {
    setDownloadStartDate(`${year}-01-01`);
    setDownloadEndDate(`${year}-12-31`);
  }, [year]);

  // Group transactions by week
  const weekBuckets: WeekBucket[] = useMemo(() => {
    const txByWeek = new Map<string, Transaction[]>();
    for (const w of yearWeeks) txByWeek.set(w.label, []);
    const unmatchedWeek: MonthMondayWeek = {
      yearMonth: '',
      weekNo: 0,
      weekStart: '',
      weekEnd: '',
      label: '미지정',
    };
    txByWeek.set(unmatchedWeek.label, []);

    for (const tx of projectTxs) {
      const d = tx.dateTime.slice(0, 10);
      const w = findWeekForDate(d, yearWeeks);
      const key = w?.label || unmatchedWeek.label;
      txByWeek.get(key)!.push(tx);
    }

    const buckets = yearWeeks.map((week) => ({
      week,
      transactions: (txByWeek.get(week.label) || []).sort((a, b) =>
        a.dateTime.localeCompare(b.dateTime),
      ),
      collapsed: collapsedWeeks.has(week.label),
    }));
    const unmatchedTxs = txByWeek.get(unmatchedWeek.label) || [];
    if (unmatchedTxs.length > 0) {
      buckets.push({
        week: unmatchedWeek,
        transactions: unmatchedTxs.sort((a, b) => a.dateTime.localeCompare(b.dateTime)),
        collapsed: collapsedWeeks.has(unmatchedWeek.label),
      });
    }
    return buckets;
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

  const dateIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '거래일시'),
    [],
  );

  const getSheetRowsForExport = useCallback(() => {
    return importRows ? renumberImportRows(importRows) : transactionsToImportRows(projectTxs, yearWeeks);
  }, [importRows, projectTxs, yearWeeks]);

  const filterRowsByDateRange = useCallback((rows: ImportRow[]) => {
    if (!downloadStartDate && !downloadEndDate) return rows;
    if (downloadStartDate && downloadEndDate && downloadStartDate > downloadEndDate) {
      throw new Error('다운로드 시작일이 종료일보다 늦습니다.');
    }
    if (dateIdx < 0) return rows;
    return rows.filter((row) => {
      const normalized = normalizeRowDateForFilter(row.cells[dateIdx]);
      if (!normalized) return false;
      if (downloadStartDate && normalized < downloadStartDate) return false;
      if (downloadEndDate && normalized > downloadEndDate) return false;
      return true;
    });
  }, [dateIdx, downloadEndDate, downloadStartDate]);

  const resolveDownloadFileStem = useCallback((suffix: string) => {
    const rangeLabel = downloadStartDate || downloadEndDate
      ? `_${downloadStartDate || 'start'}_${downloadEndDate || 'end'}`
      : '';
    return `정산대장_${projectName}_${year}${rangeLabel}.${suffix}`;
  }, [downloadEndDate, downloadStartDate, projectName, year]);

  // ── CSV Download ──
  const handleDownload = useCallback(() => {
    const csv = importRows ? exportImportRowsCsv(renumberImportRows(importRows)) : exportSettlementCsv(projectTxs, yearWeeks);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `정산대장_${projectName}_${year}.csv`);
  }, [importRows, projectTxs, yearWeeks, projectName, year]);

  const handleRangeCsvDownload = useCallback(() => {
    try {
      const rows = filterRowsByDateRange(getSheetRowsForExport());
      if (rows.length === 0) {
        toast.error('선택한 기간에 내려받을 행이 없습니다.');
        return;
      }
      const csv = exportImportRowsCsv(rows);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      triggerDownload(blob, resolveDownloadFileStem('csv'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기간 다운로드에 실패했습니다.');
    }
  }, [filterRowsByDateRange, getSheetRowsForExport, resolveDownloadFileStem]);

  const handleRangeXlsxDownload = useCallback(async () => {
    try {
      const rows = filterRowsByDateRange(getSheetRowsForExport());
      if (rows.length === 0) {
        toast.error('선택한 기간에 내려받을 행이 없습니다.');
        return;
      }
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('settlement');
      for (const row of buildImportRowsMatrix(rows)) {
        worksheet.addRow(row);
      }
      const buffer = await workbook.xlsx.writeBuffer();
      triggerDownload(
        new Blob([buffer as ArrayBuffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        resolveDownloadFileStem('xlsx'),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '기간 XLSX 다운로드에 실패했습니다.');
    }
  }, [filterRowsByDateRange, getSheetRowsForExport, resolveDownloadFileStem]);

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

    const depositIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '입금액(사업비,공급가액,은행이자)');
    const bankAmountIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
    const balanceIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액');
    const withBalances = rows.map((row) => ({ ...row }));
    if (depositIdx >= 0 && bankAmountIdx >= 0 && balanceIdx >= 0 && withBalances.length > 0) {
      const base = parseNumber(withBalances[0]?.cells?.[depositIdx]) ?? 0;
      let cumulative = 0;
      for (let i = 0; i < withBalances.length; i++) {
        const bank = parseNumber(withBalances[i].cells[bankAmountIdx]) ?? 0;
        cumulative += bank;
        const balance = base - cumulative;
        const cells = [...withBalances[i].cells];
        cells[balanceIdx] = Number.isFinite(balance) ? balance.toLocaleString('ko-KR') : '';
        withBalances[i] = { ...withBalances[i], cells };
      }
    }
    setImportRows(withBalances);
    setImportDirty(true);
  }, [projectId, defaultLedgerId]);

  const handleImportSave = useCallback(async () => {
    if (!importRows) return;
    if (!onSaveSheetRows) {
      toast.error('저장 기능이 연결되어 있지 않습니다.');
      return;
    }
    try {
      await onSaveSheetRows(importRows);
      setImportDirty(false);
      toast.success('정산대장을 저장했습니다.');
    } catch (err) {
      console.error('[SettlementLedger] save sheet failed:', err);
      toast.error('정산대장 저장에 실패했습니다.');
    }
  }, [importRows, onSaveSheetRows]);

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
    <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'sheet' | 'weekly')} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
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
          <TabsList className="h-8" data-testid="settlement-view-tabs">
            <TabsTrigger value="sheet" className="text-xs" data-testid="settlement-tab-sheet">시트 보기</TabsTrigger>
            <TabsTrigger value="weekly" className="text-xs" data-testid="settlement-tab-weekly">주차 보기</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewMode === 'weekly' && (
            <>
              <Button variant="outline" size="sm" onClick={expandAll}>
                전체 펼치기
              </Button>
              <Button variant="outline" size="sm" onClick={collapseAll}>
                전체 접기
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            전체 CSV
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

      <div className="flex items-center justify-between gap-2 flex-wrap rounded-lg border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-muted-foreground" htmlFor="settlement-download-start">다운로드 기간</label>
          <input
            id="settlement-download-start"
            type="date"
            value={downloadStartDate}
            data-testid="settlement-download-start"
            className="rounded border bg-background px-2 py-1 text-[11px]"
            onChange={(e) => setDownloadStartDate(e.target.value)}
          />
          <span className="text-[11px] text-muted-foreground">~</span>
          <input
            type="date"
            value={downloadEndDate}
            data-testid="settlement-download-end"
            className="rounded border bg-background px-2 py-1 text-[11px]"
            onChange={(e) => setDownloadEndDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleRangeCsvDownload} data-testid="settlement-download-range-csv">
            기간 CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleRangeXlsxDownload()} data-testid="settlement-download-range-xlsx">
            기간 XLSX
          </Button>
        </div>
      </div>

      <TabsContent value="sheet">
        {importRows && (
          <ImportEditor
            rows={importRows}
            onChange={(rows) => {
              setImportRows(rows);
              setImportDirty(true);
            }}
            onSave={handleImportSave}
            onCancel={() => {
              setImportRows(transactionsToImportRows(projectTxs, yearWeeks));
              setImportDirty(false);
            }}
            projectId={projectId}
            defaultLedgerId={defaultLedgerId}
            evidenceRequiredMap={evidenceRequiredMap}
            onSaveEvidenceRequiredMap={onSaveEvidenceRequiredMap}
            inline
          />
        )}
      </TabsContent>

      <TabsContent value="weekly">
        <div className="relative w-full overflow-x-auto border rounded-lg">
          <table className="w-full text-[11px] border-collapse">
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
              <tr className="bg-slate-50 dark:bg-slate-900">
                {SETTLEMENT_COLUMNS.map((col, i) => (
                  <th
                    key={i}
                    className={`px-2 py-1.5 font-medium border-b border-r whitespace-nowrap text-[10px] ${col.format === 'number' ? 'text-right' : 'text-left'}`}
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
      </TabsContent>
    </Tabs>
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
  const hasDrafts = draftTxIds.length > 0 && userRole === 'pm' && week.weekNo > 0;
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
  const parsedSettlementNote = parseSettlementNote(tx.settlementNote, tx.settlementProgress || 'INCOMPLETE');

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
          defaultValue={tx.method || ''}
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
      <td className="px-1 py-0.5 border-b border-r">
        <div className="min-w-[140px]">
          <input
            type="text"
            defaultValue={parsedSettlementNote.note}
            disabled={locked}
            className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onBlur={(e) => {
              if (!locked && e.target.value !== parsedSettlementNote.note) {
                debouncedUpdate({ settlementNote: e.target.value });
              }
            }}
          />
          <select
            defaultValue={parsedSettlementNote.progress}
            disabled={locked}
            className={`mt-1 w-full rounded border bg-background/60 px-1 py-0.5 text-[10px] ${locked ? 'text-muted-foreground cursor-not-allowed' : ''}`}
            onChange={(e) => {
              if (!locked) {
                onUpdate({ settlementProgress: e.target.value as NonNullable<Transaction['settlementProgress']> });
              }
            }}
          >
            {SETTLEMENT_PROGRESS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </td>
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
  evidenceRequiredMap,
  onSaveEvidenceRequiredMap,
  inline = false,
}: {
  rows: ImportRow[];
  onChange: (rows: ImportRow[]) => void;
  onSave: () => void;
  onCancel: () => void;
  projectId: string;
  defaultLedgerId: string;
  evidenceRequiredMap?: Record<string, string>;
  onSaveEvidenceRequiredMap?: (map: Record<string, string>) => void | Promise<void>;
  inline?: boolean;
}) {
  const errorCount = rows.filter((r) => r.error).length;
  const validCount = rows.length - errorCount;
  const budgetCodeIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비목'),
    [],
  );
  const subCodeIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '세목'),
    [],
  );
  const evidenceIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '필수증빙자료 리스트'),
    [],
  );
  const depositIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '입금액(사업비,공급가액,은행이자)'),
    [],
  );
  const bankAmountIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액'),
    [],
  );
  const balanceIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액'),
    [],
  );
  const mappingRows = useMemo(
    () => BUDGET_CODE_BOOK.flatMap((c) => c.subCodes.map((subCode) => ({
      budgetCode: c.code,
      subCode,
      key: `${c.code}|${subCode}`,
    }))),
    [],
  );
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [mappingSaving, setMappingSaving] = useState(false);

  const recomputeBalances = useCallback(
    (input: ImportRow[]) => {
      if (depositIdx < 0 || bankAmountIdx < 0 || balanceIdx < 0) return input;
      const base = parseNumber(input[0]?.cells?.[depositIdx]) ?? 0;
      let cumulative = 0;
      return input.map((row, i) => {
        const bank = parseNumber(row.cells[bankAmountIdx]) ?? 0;
        cumulative += bank;
        const balance = base - cumulative;
        const cells = [...row.cells];
        cells[balanceIdx] = Number.isFinite(balance) ? balance.toLocaleString('ko-KR') : '';
        return { ...row, cells };
      });
    },
    [depositIdx, bankAmountIdx, balanceIdx],
  );

  const applyDerivedRows = useCallback(
    (input: ImportRow[]) => {
      const normalized = renumberImportRows(input);
      const recalced = recomputeBalances(normalized);
      return recalced.map((row, i) => {
        const result = importRowToTransaction(row, projectId, defaultLedgerId, i);
        return { ...row, error: result.error };
      });
    },
    [recomputeBalances, projectId, defaultLedgerId],
  );

  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = [...r.cells];
        cells[colIdx] = value;
        return { ...r, cells };
      });
      onChange(applyDerivedRows(next));
    },
    [rows, onChange, applyDerivedRows],
  );

  const updateRow = useCallback(
    (rowIdx: number, updater: (row: ImportRow) => ImportRow) => {
      const next = rows.map((r, i) => {
        if (i !== rowIdx) return r;
        let updated = updater(r);
        if (budgetCodeIdx >= 0 && subCodeIdx >= 0 && evidenceIdx >= 0 && evidenceRequiredMap) {
          const budgetCode = updated.cells[budgetCodeIdx] || '';
          const subCode = updated.cells[subCodeIdx] || '';
          const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
          if (mapped) {
            const cells = [...updated.cells];
            cells[evidenceIdx] = mapped;
            updated = { ...updated, cells };
          }
        }
        return updated;
      });
      onChange(applyDerivedRows(next));
    },
    [rows, onChange, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap, applyDerivedRows],
  );

  const addRow = useCallback(() => {
    const newRow = createEmptyImportRow();
    newRow.error = undefined;
    onChange(applyDerivedRows([...rows, newRow]));
  }, [rows, onChange, applyDerivedRows]);

  const addRows = useCallback((count: number) => {
    if (count <= 0) return;
    const nextRows = [...rows];
    for (let i = 0; i < count; i++) {
      nextRows.push(createEmptyImportRow());
    }
    onChange(applyDerivedRows(nextRows));
  }, [rows, onChange, applyDerivedRows]);

  useEffect(() => {
    if (!inline) return;
    if (rows.length >= 20) return;
    addRows(20 - rows.length);
  }, [rows.length, inline, addRows]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      onChange(applyDerivedRows(rows.filter((_, i) => i !== rowIdx)));
    },
    [rows, onChange, applyDerivedRows],
  );

  const insertRowAt = useCallback(
    (rowIdx: number) => {
      const nextRows = [...rows];
      nextRows.splice(rowIdx + 1, 0, createEmptyImportRow());
      onChange(applyDerivedRows(nextRows));
    },
    [rows, onChange, applyDerivedRows],
  );

  const applyEvidenceMapping = useCallback((rowIdx?: number) => {
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || evidenceIdx < 0) return;
    if (!evidenceRequiredMap || Object.keys(evidenceRequiredMap).length === 0) return;
    const next = rows.map((r, i) => {
      if (rowIdx != null && i !== rowIdx) return r;
      const budgetCode = r.cells[budgetCodeIdx] || '';
      const subCode = r.cells[subCodeIdx] || '';
      const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, subCode);
      if (!mapped) return r;
      const cells = [...r.cells];
      cells[evidenceIdx] = mapped;
      const updated: ImportRow = { ...r, cells };
      const result = importRowToTransaction(updated, projectId, defaultLedgerId, i);
      updated.error = result.error;
      return updated;
    });
    onChange(next);
  }, [rows, onChange, projectId, defaultLedgerId, budgetCodeIdx, subCodeIdx, evidenceIdx, evidenceRequiredMap]);

  const openMappingEditor = useCallback(() => {
    setMappingDraft({ ...(evidenceRequiredMap || {}) });
    setMappingOpen(true);
  }, [evidenceRequiredMap]);

  const saveMappingEditor = useCallback(async () => {
    if (!onSaveEvidenceRequiredMap) {
      toast.message('증빙 매핑 저장 기능이 없습니다.');
      return;
    }
    const nextMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(mappingDraft)) {
      const trimmed = value.trim();
      if (trimmed) nextMap[key] = trimmed;
    }
    setMappingSaving(true);
    try {
      await onSaveEvidenceRequiredMap(nextMap);
      setMappingOpen(false);
      applyEvidenceMapping();
      toast.success('증빙 매핑이 저장되었습니다');
    } catch (err) {
      console.error('[SettlementLedger] save evidence map failed:', err);
      toast.error('증빙 매핑 저장에 실패했습니다');
    } finally {
      setMappingSaving(false);
    }
  }, [mappingDraft, onSaveEvidenceRequiredMap]);

  return (
    <div className={inline ? 'relative border rounded-lg bg-background flex flex-col overflow-visible' : 'fixed inset-0 z-50 bg-background/95 flex flex-col'}>
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-4 py-2.5 border-b bg-muted/30 shrink-0 ${inline ? 'sticky top-0 z-20' : ''}`}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold">정산대장 편집</h3>
          <Badge variant="default" className="text-[10px]">{validCount}건 유효</Badge>
          {errorCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">{errorCount}건 오류</Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            셀을 직접 수정하거나 행을 추가할 수 있습니다
          </span>
          <span className="text-[10px] text-muted-foreground">
            Enter/Shift+Enter, ↑↓, 텍스트 끝의 ←→ 로 셀 이동
          </span>
          <span className="text-[10px] text-amber-700 dark:text-amber-300">
            매입부가세는 계산값이 아니라 영수증 기준 확인값입니다
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={openMappingEditor}>
            증빙 매핑 설정
          </Button>
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
      <div className={inline ? 'overflow-auto max-h-[calc(100vh-260px)]' : 'flex-1 overflow-auto'}>
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
                onRowChange={(updater) => updateRow(rowIdx, updater)}
                onInsertBelow={() => insertRowAt(rowIdx)}
                onRemove={() => removeRow(rowIdx)}
                budgetCodeIdx={budgetCodeIdx}
                subCodeIdx={subCodeIdx}
                evidenceIdx={evidenceIdx}
                evidenceRequiredMap={evidenceRequiredMap}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={SETTLEMENT_COLUMNS.length + 1}
                  className="px-4 py-8 text-center text-[12px] text-muted-foreground"
                >
                  데이터가 없습니다. 행을 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {mappingOpen && (
        <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4 pointer-events-auto">
          <div className="w-full max-w-3xl bg-background rounded-lg border shadow-lg flex flex-col max-h-[80vh] pointer-events-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h4 className="text-sm font-bold">증빙 매핑 설정</h4>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setMappingOpen(false)}>닫기</Button>
                <Button size="sm" onClick={saveMappingEditor} disabled={mappingSaving}>
                  {mappingSaving ? '저장중...' : '저장'}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 border-b text-left">비목</th>
                    <th className="px-2 py-2 border-b text-left">세목</th>
                    <th className="px-2 py-2 border-b text-left">필수증빙자료 리스트</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingRows.map((row) => (
                    <tr key={row.key} className="border-b">
                      <td className="px-2 py-1.5">{row.budgetCode}</td>
                      <td className="px-2 py-1.5">{row.subCode}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          value={mappingDraft[row.key] || ''}
                          className="w-full bg-transparent outline-none text-[11px] px-2 py-1 border rounded"
                          placeholder="예: 세금계산서, 이체확인증"
                          onChange={(e) => {
                            const next = { ...mappingDraft, [row.key]: e.target.value };
                            setMappingDraft(next);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportEditorRow({
  row,
  rowIdx,
  onCellChange,
  onRowChange,
  onInsertBelow,
  onRemove,
  budgetCodeIdx,
  subCodeIdx,
  evidenceIdx,
  evidenceRequiredMap,
}: {
  row: ImportRow;
  rowIdx: number;
  onCellChange: (colIdx: number, value: string) => void;
  onRowChange: (updater: (row: ImportRow) => ImportRow) => void;
  onInsertBelow: () => void;
  onRemove: () => void;
  budgetCodeIdx: number;
  subCodeIdx: number;
  evidenceIdx: number;
  evidenceRequiredMap?: Record<string, string>;
}) {
  const hasError = Boolean(row.error);
  const methodIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지출구분'),
    [],
  );
  const dateIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시'),
    [],
  );
  const expenseAmountIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '사업비 사용액'),
    [],
  );
  const bankAmountIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액'),
    [],
  );
  const vatIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '매입부가세'),
    [],
  );
  const driveLinkIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '증빙자료 드라이브'),
    [],
  );
  const noteIdx = useMemo(
    () => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '비고'),
    [],
  );
  const budgetCode = budgetCodeIdx >= 0 ? row.cells[budgetCodeIdx] : '';
  const subCodes = useMemo(() => {
    const entry = BUDGET_CODE_BOOK.find((c) => c.code === budgetCode);
    return entry ? entry.subCodes : [];
  }, [budgetCode]);
  const parsedSettlementNote = useMemo(
    () => parseSettlementNote(noteIdx >= 0 ? row.cells[noteIdx] : '', 'INCOMPLETE'),
    [noteIdx, row.cells],
  );
  const progressValue = parsedSettlementNote.progress;
  const derivedSupplyAmount = useMemo(() => {
    if (!featureFlags.qaP0SettlementV1) return '';
    const bankAmount = parseNumber(row.cells[bankAmountIdx]) ?? 0;
    const expenseAmount = parseNumber(row.cells[expenseAmountIdx]) ?? 0;
    const vatIn = parseNumber(row.cells[vatIdx]) ?? 0;
    const hasExpenseContext = bankAmount > 0 || expenseAmount > 0 || vatIn > 0;
    if (!hasExpenseContext) return '';
    return deriveSettlementAmounts({
      direction: 'OUT',
      amounts: { bankAmount, expenseAmount, vatIn },
    }).supplyAmount.toLocaleString('ko-KR');
  }, [bankAmountIdx, expenseAmountIdx, row.cells, vatIdx]);

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
            onClick={onInsertBelow}
            className="text-muted-foreground/60 hover:text-primary transition-colors"
            title="아래 행 삽입"
            data-testid={`settlement-row-insert-${rowIdx + 1}`}
          >
            <Plus className="h-3 w-3" />
          </button>
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
        const isBudgetCode = colIdx === budgetCodeIdx;
        const isSubCode = colIdx === subCodeIdx;
        const isDriveLink = colIdx === driveLinkIdx;
        const isVat = colIdx === vatIdx;
        const isNote = colIdx === noteIdx;
        const fieldLabel = `${rowIdx + 1}행 ${col.csvHeader}`;
        const primaryNavProps = {
          'data-grid-row': rowIdx,
          'data-grid-col': colIdx,
          'data-grid-slot': 'primary' as const,
          onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) =>
            handleGridKeyDown(event, rowIdx, colIdx, 'primary'),
        };
        return (
          <td key={colIdx} className="px-0.5 py-0.5 border-b border-r">
            {isReadOnly ? (
              <input
                type="text"
                readOnly
                aria-label={fieldLabel}
                data-testid={toCellTestId(rowIdx, col.csvHeader)}
                value={row.cells[colIdx] || ''}
                className="w-full bg-transparent outline-none text-[10px] text-muted-foreground px-1 py-0.5"
                {...primaryNavProps}
              />
            ) : colIdx === methodIdx ? (
              <select
                value={row.cells[colIdx] || ''}
                aria-label={fieldLabel}
                data-testid={toCellTestId(rowIdx, col.csvHeader)}
                className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[80px]"
                onChange={(e) => {
                  if (e.target.value !== row.cells[colIdx]) {
                    onCellChange(colIdx, e.target.value);
                  }
                }}
                {...primaryNavProps}
              >
                <option value="">-</option>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.label}>{o.label}</option>
                ))}
              </select>
            ) : isBudgetCode ? (
              <select
                value={row.cells[colIdx] || ''}
                aria-label={fieldLabel}
                data-testid={toCellTestId(rowIdx, col.csvHeader)}
                className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[90px]"
                onChange={(e) => {
                  const nextCode = e.target.value;
                  onRowChange((prev) => {
                    if (budgetCodeIdx < 0) return prev;
                    const cells = [...prev.cells];
                    cells[budgetCodeIdx] = nextCode;
                    if (subCodeIdx >= 0) {
                      const allowed = BUDGET_CODE_BOOK.find((c) => c.code === nextCode)?.subCodes || [];
                      if (!allowed.includes(cells[subCodeIdx])) cells[subCodeIdx] = '';
                    }
                    if (evidenceIdx >= 0) {
                      const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, nextCode, cells[subCodeIdx] || '');
                      if (mapped) cells[evidenceIdx] = mapped;
                    }
                    return { ...prev, cells };
                  });
                }}
                {...primaryNavProps}
              >
                <option value="">-</option>
                {BUDGET_CODE_BOOK.map((c) => (
                  <option key={c.code} value={c.code}>{c.code}</option>
                ))}
              </select>
            ) : isSubCode ? (
              <select
                value={row.cells[colIdx] || ''}
                disabled={!budgetCode}
                aria-label={fieldLabel}
                data-testid={toCellTestId(rowIdx, col.csvHeader)}
                className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[90px]"
                onChange={(e) => {
                  const nextSub = e.target.value;
                  onRowChange((prev) => {
                    if (subCodeIdx < 0) return prev;
                    const cells = [...prev.cells];
                    cells[subCodeIdx] = nextSub;
                    if (evidenceIdx >= 0) {
                      const mapped = resolveEvidenceRequiredDesc(evidenceRequiredMap, budgetCode, nextSub);
                      if (mapped) cells[evidenceIdx] = mapped;
                    }
                    return { ...prev, cells };
                  });
                }}
                {...primaryNavProps}
              >
                <option value="">-</option>
                {subCodes.map((sc) => (
                  <option key={sc} value={sc}>{sc}</option>
                ))}
              </select>
            ) : isDriveLink ? (
              <div className="flex items-center gap-1 min-w-[180px]">
                <input
                  type="text"
                  aria-label={fieldLabel}
                  data-testid={toCellTestId(rowIdx, col.csvHeader)}
                  value={row.cells[colIdx] || ''}
                  placeholder="Drive URL"
                  className="flex-1 bg-transparent outline-none text-[11px] px-1 py-0.5"
                  onChange={(e) => onCellChange(colIdx, e.target.value)}
                  {...primaryNavProps}
                />
                {isValidDriveUrl(row.cells[colIdx] || '') && (
                  <a
                    href={row.cells[colIdx]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${fieldLabel} 열기`}
                    data-testid={toCellTestId(rowIdx, `${col.csvHeader}-open`)}
                    className="shrink-0 inline-flex h-6 items-center rounded-md border px-2 text-[10px] text-blue-600 hover:bg-blue-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    열기
                  </a>
                )}
              </div>
            ) : isVat ? (
              <div className="min-w-[90px]">
                <input
                  type="text"
                  aria-label={fieldLabel}
                  data-testid={toCellTestId(rowIdx, col.csvHeader)}
                  value={row.cells[colIdx] || ''}
                  className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 ${hasError && colIdx === dateIdx && !row.cells[colIdx]
                    ? 'ring-1 ring-red-300 rounded'
                    : ''
                    }`}
                  onChange={(e) => onCellChange(colIdx, e.target.value)}
                  {...primaryNavProps}
                />
                {derivedSupplyAmount && (
                  <span className="block px-1 pb-0.5 text-[9px] text-muted-foreground">
                    공급가액 {derivedSupplyAmount}
                  </span>
                )}
              </div>
            ) : isNote ? (
              <div className="min-w-[140px]">
                <input
                  type="text"
                  aria-label={fieldLabel}
                  data-testid={toCellTestId(rowIdx, col.csvHeader)}
                  value={parsedSettlementNote.note}
                  className="w-full bg-transparent outline-none text-[11px] px-1 py-0.5"
                  onChange={(e) => onCellChange(colIdx, composeSettlementNote(progressValue, e.target.value))}
                  {...primaryNavProps}
                />
                <select
                  value={progressValue}
                  aria-label={`${fieldLabel} 상태`}
                  data-testid={toCellTestId(rowIdx, `${col.csvHeader}-status`)}
                  className="mt-1 w-full rounded border bg-background/60 px-1 py-0.5 text-[10px]"
                  onChange={(e) => {
                    const nextProgress = e.target.value as NonNullable<Transaction['settlementProgress']>;
                    onCellChange(colIdx, composeSettlementNote(nextProgress, parsedSettlementNote.note));
                  }}
                  data-grid-row={rowIdx}
                  data-grid-col={colIdx}
                  data-grid-slot="secondary"
                  onKeyDown={(event) => handleGridKeyDown(event, rowIdx, colIdx, 'secondary')}
                >
                  {SETTLEMENT_PROGRESS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <input
                type="text"
                aria-label={fieldLabel}
                data-testid={toCellTestId(rowIdx, col.csvHeader)}
                value={row.cells[colIdx] || ''}
                className={`w-full bg-transparent outline-none text-[11px] px-1 py-0.5 min-w-[50px] ${hasError && colIdx === dateIdx && !row.cells[colIdx]
                  ? 'ring-1 ring-red-300 rounded'
                  : ''
                  }`}
                onChange={(e) => onCellChange(colIdx, e.target.value)}
                {...primaryNavProps}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}
