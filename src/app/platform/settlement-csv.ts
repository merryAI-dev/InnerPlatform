// ── Settlement Ledger CSV column definitions & bidirectional mapping ──

import type { Transaction, CashflowSheetLineId, PaymentMethod, Direction } from '../data/types';
import { CASHFLOW_SHEET_LINE_LABELS } from '../data/types';
import type { MonthMondayWeek } from './cashflow-weeks';
import { findWeekForDate, getYearMondayWeeks } from './cashflow-weeks';
import { pickValue, parseNumber, parseDate, stableHash, normalizeSpace, normalizeKey } from './csv-utils';

// ── Cashflow line label ↔ id mapping ──

const LABEL_TO_LINE_ID: Record<string, CashflowSheetLineId> = {};
const LINE_ID_TO_LABEL: Record<string, string> = {};
for (const [id, label] of Object.entries(CASHFLOW_SHEET_LINE_LABELS)) {
  LABEL_TO_LINE_ID[label] = id as CashflowSheetLineId;
  LINE_ID_TO_LABEL[id] = label;
}
// Short alias mapping for CSV import flexibility
const CASHFLOW_LABEL_ALIASES: Record<string, CashflowSheetLineId> = {
  'MYSC선입금': 'MYSC_PREPAY_IN',
  'MYSC선입금(입금필요시)': 'MYSC_PREPAY_IN',
  'MYSC 선입금(입금필요시)': 'MYSC_PREPAY_IN',
  '매출액(입금)': 'SALES_IN',
  '매출부가세(입금)': 'SALES_VAT_IN',
  '팀지원금(입금)': 'TEAM_SUPPORT_IN',
  '은행이자(입금)': 'BANK_INTEREST_IN',
  '직접사업비(공급가액)': 'DIRECT_COST_OUT',
  '직접사업비': 'DIRECT_COST_OUT',
  '매입부가세': 'INPUT_VAT_OUT',
  'MYSC인건비': 'MYSC_LABOR_OUT',
  'MYSC 인건비': 'MYSC_LABOR_OUT',
  'MYSC수익(간접비등)': 'MYSC_PROFIT_OUT',
  'MYSC 수익(간접비등)': 'MYSC_PROFIT_OUT',
  'MYSC수익': 'MYSC_PROFIT_OUT',
  '매출부가세(출금)': 'SALES_VAT_OUT',
  '팀지원금(출금)': 'TEAM_SUPPORT_OUT',
  '은행이자(출금)': 'BANK_INTEREST_OUT',
};

export function parseCashflowLineLabel(raw: string): CashflowSheetLineId | undefined {
  if (!raw) return undefined;
  const trimmed = normalizeSpace(raw);
  if (LABEL_TO_LINE_ID[trimmed]) return LABEL_TO_LINE_ID[trimmed];
  if (CASHFLOW_LABEL_ALIASES[trimmed]) return CASHFLOW_LABEL_ALIASES[trimmed];
  // Fuzzy: strip spaces/parens and check again
  const stripped = trimmed.replace(/\s+/g, '');
  for (const [alias, id] of Object.entries(CASHFLOW_LABEL_ALIASES)) {
    if (alias.replace(/\s+/g, '') === stripped) return id;
  }
  return undefined;
}

export function getCashflowLineLabelForExport(lineId: CashflowSheetLineId | string | undefined): string {
  if (!lineId) return '';
  return LINE_ID_TO_LABEL[lineId] || lineId;
}

/** All valid cashflow line labels for dropdown. */
export const CASHFLOW_LINE_OPTIONS: { value: CashflowSheetLineId; label: string }[] = (
  Object.entries(CASHFLOW_SHEET_LINE_LABELS) as [CashflowSheetLineId, string][]
).map(([value, label]) => ({ value, label }));

// ── CSV column definitions ──

export interface SettlementColumn {
  csvHeader: string;
  group: string;
  /** Path into Transaction (dot-separated for nested, null for computed). */
  txField: string | null;
  format: 'string' | 'number' | 'boolean' | 'date';
}

export const SETTLEMENT_COLUMNS: SettlementColumn[] = [
  { csvHeader: '작성자', group: '기본정보', txField: 'author', format: 'string' },
  { csvHeader: 'No.', group: '기본정보', txField: null, format: 'number' },
  { csvHeader: '거래일시', group: '기본정보', txField: 'dateTime', format: 'date' },
  { csvHeader: '해당 주차', group: '기본정보', txField: null, format: 'string' },
  { csvHeader: '지출구분', group: '기본정보', txField: 'method', format: 'string' },
  { csvHeader: '비목', group: '기본정보', txField: 'budgetCategory', format: 'string' },
  { csvHeader: '세목', group: '기본정보', txField: 'budgetSubCategory', format: 'string' },
  { csvHeader: '세세목', group: '기본정보', txField: 'budgetSubSubCategory', format: 'string' },
  { csvHeader: 'cashflow항목', group: '기본정보', txField: 'cashflowLabel', format: 'string' },
  { csvHeader: '통장잔액', group: '기본정보', txField: 'amounts.balanceAfter', format: 'number' },
  { csvHeader: '통장에 찍힌 입/출금액', group: '기본정보', txField: 'amounts.bankAmount', format: 'number' },
  // 입금합계
  { csvHeader: '입금액(사업비,공급가액,은행이자)', group: '입금합계', txField: 'amounts.depositAmount', format: 'number' },
  { csvHeader: '매입부가세 반환', group: '입금합계', txField: 'amounts.vatRefund', format: 'number' },
  // 출금합계
  { csvHeader: '사업비 사용액', group: '출금합계', txField: 'amounts.expenseAmount', format: 'number' },
  { csvHeader: '매입부가세', group: '출금합계', txField: 'amounts.vatIn', format: 'number' },
  // 사업팀
  { csvHeader: '지급처', group: '사업팀', txField: 'counterparty', format: 'string' },
  { csvHeader: '상세 적요', group: '사업팀', txField: 'memo', format: 'string' },
  { csvHeader: '필수증빙자료 리스트', group: '사업팀', txField: 'evidenceRequiredDesc', format: 'string' },
  { csvHeader: '실제 구비 완료된 증빙자료 리스트', group: '사업팀', txField: 'evidenceCompletedDesc', format: 'string' },
  { csvHeader: '준비필요자료', group: '사업팀', txField: 'evidencePendingDesc', format: 'string' },
  // 정산지원 담당자
  { csvHeader: '증빙자료 드라이브', group: '정산지원', txField: 'evidenceDriveLink', format: 'string' },
  { csvHeader: '준비 필요자료', group: '정산지원', txField: 'supportPendingDocs', format: 'string' },
  // 도담
  { csvHeader: 'e나라 등록', group: '도담', txField: 'eNaraRegistered', format: 'string' },
  { csvHeader: 'e나라 집행', group: '도담', txField: 'eNaraExecuted', format: 'string' },
  { csvHeader: '부가세 지결 완료여부', group: '도담', txField: 'vatSettlementDone', format: 'boolean' },
  { csvHeader: '최종완료', group: '도담', txField: 'settlementComplete', format: 'boolean' },
  // 비고
  { csvHeader: '비고', group: '비고', txField: 'settlementNote', format: 'string' },
];

/** Unique column groups in order. */
export const SETTLEMENT_COLUMN_GROUPS = (() => {
  const seen = new Set<string>();
  const groups: { name: string; colSpan: number }[] = [];
  for (const col of SETTLEMENT_COLUMNS) {
    if (!seen.has(col.group)) {
      seen.add(col.group);
      groups.push({ name: col.group, colSpan: 0 });
    }
    groups[groups.length - 1].colSpan++;
  }
  return groups;
})();

// ── Payment method display ──

const METHOD_LABELS: Record<string, string> = {
  TRANSFER: '계좌이체',
  CORP_CARD_1: '법인카드',
  CORP_CARD_2: '법인카드(뒷번호2)',
  OTHER: '기타',
};

function methodToLabel(method: string | undefined): string {
  return (method && METHOD_LABELS[method]) || method || '';
}

function labelToMethod(raw: string): PaymentMethod {
  const s = normalizeSpace(raw).toLowerCase();
  if (/법인카드.*1|뒷번호1|card.?1/.test(s)) return 'CORP_CARD_1';
  if (/법인카드.*2|뒷번호2|card.?2/.test(s)) return 'CORP_CARD_2';
  if (/법인카드|카드|card/.test(s)) return 'CORP_CARD_1';
  if (/계좌|이체|bank/.test(s)) return 'TRANSFER';
  return 'OTHER';
}

// ── Direction inference from cashflow line ──

const IN_LINE_IDS = new Set<string>([
  'MYSC_PREPAY_IN', 'SALES_IN', 'SALES_VAT_IN', 'TEAM_SUPPORT_IN', 'BANK_INTEREST_IN',
]);

function inferDirection(lineId: CashflowSheetLineId | undefined): Direction {
  if (lineId && IN_LINE_IDS.has(lineId)) return 'IN';
  return 'OUT';
}

// ── Export (Transaction[] → CSV string) ──

function getNestedValue(tx: Transaction, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = tx;
  for (const p of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

function formatCellValue(val: unknown, format: string): string {
  if (val == null) return '';
  if (format === 'number') {
    const n = typeof val === 'number' ? val : Number(val);
    return Number.isFinite(n) ? n.toLocaleString('ko-KR') : '';
  }
  if (format === 'boolean') {
    return val === true || val === 'true' || val === 'Y' ? 'Y' : '';
  }
  return String(val);
}

export function exportSettlementCsv(
  transactions: Transaction[],
  weeks: MonthMondayWeek[],
): string {
  // Sort by date
  const sorted = [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  // Group by week label
  const grouped = new Map<string, Transaction[]>();
  for (const w of weeks) {
    grouped.set(w.label, []);
  }
  for (const tx of sorted) {
    const dateStr = tx.dateTime.slice(0, 10);
    const w = findWeekForDate(dateStr, weeks);
    const key = w ? w.label : '__unmatched__';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(tx);
  }

  const rows: string[][] = [];

  // Group header row
  rows.push(SETTLEMENT_COLUMN_GROUPS.map((g) => g.name).flatMap((name, i) => {
    const colSpan = SETTLEMENT_COLUMN_GROUPS[i].colSpan;
    return [name, ...Array(colSpan - 1).fill('')];
  }));

  // Column header row
  rows.push(SETTLEMENT_COLUMNS.map((c) => c.csvHeader));

  let rowNum = 0;
  for (const week of weeks) {
    const txs = grouped.get(week.label) || [];
    if (txs.length === 0) continue; // skip empty weeks in export

    for (const tx of txs) {
      rowNum++;
      const row: string[] = SETTLEMENT_COLUMNS.map((col) => {
        if (col.csvHeader === 'No.') return String(rowNum);
        if (col.csvHeader === '해당 주차') return week.label;
        if (col.csvHeader === '지출구분') return methodToLabel(tx.method);
        if (col.csvHeader === 'cashflow항목') return getCashflowLineLabelForExport(tx.cashflowLabel || undefined);
        if (col.csvHeader === '부가세 지결 완료여부') return tx.vatSettlementDone ? 'Y' : '';
        if (col.csvHeader === '최종완료') return tx.settlementComplete ? 'Y' : '';
        if (!col.txField) return '';
        const val = getNestedValue(tx, col.txField);
        return formatCellValue(val, col.format);
      });
      rows.push(row);
    }
  }

  // CSV serialization
  return rows.map((row) => row.map((cell) => {
    if (cell.includes('"') || cell.includes(',') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }).join(',')).join('\n');
}

export function exportImportRowsCsv(rows: ImportRow[]): string {
  const data: string[][] = [];
  // Group header row
  data.push(SETTLEMENT_COLUMN_GROUPS.map((g) => g.name).flatMap((name, i) => {
    const colSpan = SETTLEMENT_COLUMN_GROUPS[i].colSpan;
    return [name, ...Array(colSpan - 1).fill('')];
  }));
  // Column header row
  data.push(SETTLEMENT_COLUMNS.map((c) => c.csvHeader));

  for (const row of rows) {
    data.push(row.cells.map((c) => c ?? ''));
  }

  return data
    .map((line) =>
      line
        .map((cell) => {
          const s = String(cell ?? '');
          if (s.includes('"') || s.includes(',') || s.includes('\n')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(','),
    )
    .join('\n');
}

// ── Import (CSV matrix → Transaction[]) ──

export interface SettlementParseResult {
  valid: Transaction[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

function findHeaderRowIdx(matrix: string[][]): number {
  if (matrix.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -1;
  const targetKeys = SETTLEMENT_COLUMNS.map((c) => normalizeKey(c.csvHeader));
  const scanMax = Math.min(5, matrix.length);
  for (let i = 0; i < scanMax; i++) {
    const row = matrix[i];
    let score = 0;
    for (const cell of row) {
      const src = normalizeKey(cell || '');
      if (!src) continue;
      if (targetKeys.includes(src)) score += 3;
      else if (targetKeys.some((t) => src.includes(t) || t.includes(src))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function parseSettlementCsv(
  matrix: string[][],
  projectId: string,
  ledgerId: string,
): SettlementParseResult {
  if (matrix.length < 2) {
    return { valid: [], errors: [{ row: 0, message: '헤더 행이 없습니다' }], warnings: [] };
  }

  const headerRowIdx = findHeaderRowIdx(matrix);

  const headers = matrix[headerRowIdx].map((h) => normalizeSpace(h));
  const dataRows = matrix.slice(headerRowIdx + 1);

  const valid: Transaction[] = [];
  const errors: { row: number; message: string }[] = [];
  const warnings: { row: number; message: string }[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    const rowNum = headerRowIdx + i + 2; // 1-based display row

    // Build key-value map from headers
    const kv: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) kv[headers[j]] = normalizeSpace(cells[j] || '');
    }

    // Skip empty rows
    const dateRaw = pickValue(kv, ['거래일시', '거래일', 'dateTime']);
    const amountRaw = pickValue(kv, ['통장에 찍힌 입/출금액', '입출금액', 'bankAmount', '금액']);
    if (!dateRaw && !amountRaw) continue;

    const dateTime = dateRaw ? parseDate(dateRaw) : '';
    if (dateRaw && !dateTime) {
      errors.push({ row: rowNum, message: '거래일시를 파싱할 수 없습니다' });
      continue;
    }

    const bankAmount = parseNumber(amountRaw) ?? 0;
    const methodRaw = pickValue(kv, ['지출구분', '결제수단', 'method']);
    const method = labelToMethod(methodRaw);

    const budgetCategory = pickValue(kv, ['비목', 'budgetCategory']);
    const budgetSubCategory = pickValue(kv, ['세목', 'budgetSubCategory']);
    const budgetSubSubCategory = pickValue(kv, ['세세목', 'budgetSubSubCategory']);

    const cashflowLabelRaw = pickValue(kv, ['cashflow항목', 'cashflowLabel', 'cashflow']);
    const lineId = parseCashflowLineLabel(cashflowLabelRaw);
    const direction = inferDirection(lineId);
    const cashflowLabel = lineId ? getCashflowLineLabelForExport(lineId) : cashflowLabelRaw;

    const balanceAfter = parseNumber(pickValue(kv, ['통장잔액', 'balanceAfter'])) ?? 0;
    const depositAmount = parseNumber(pickValue(kv, ['입금액', 'depositAmount'])) ?? 0;
    const vatRefund = parseNumber(pickValue(kv, ['매입부가세 반환', 'vatRefund'])) ?? 0;
    const expenseAmount = parseNumber(pickValue(kv, ['사업비 사용액', 'expenseAmount'])) ?? 0;
    const vatIn = parseNumber(pickValue(kv, ['매입부가세', 'vatIn'])) ?? 0;

    const counterparty = pickValue(kv, ['지급처', '거래처', 'counterparty']);
    const memo = pickValue(kv, ['상세 적요', '적요', 'memo']);
    const author = pickValue(kv, ['작성자', 'author']);

    const id = `stl-${stableHash(`${projectId}|${dateTime}|${counterparty}|${bankAmount}|${i}`)}`;

    // Map cashflowLabel to a CashflowCategory for compatibility
    const cashflowCategory = inferCashflowCategory(lineId, direction);

    const tx: Transaction = {
      id,
      ledgerId,
      projectId,
      state: 'DRAFT',
      dateTime,
      weekCode: '', // will be set by the caller or computed
      direction,
      method,
      cashflowCategory,
      cashflowLabel,
      budgetCategory: budgetCategory || undefined,
      counterparty,
      memo,
      amounts: {
        bankAmount,
        depositAmount,
        expenseAmount,
        vatIn,
        vatOut: 0,
        vatRefund,
        balanceAfter,
      },
      evidenceRequired: [],
      evidenceStatus: 'MISSING',
      evidenceMissing: [],
      attachmentsCount: 0,
      createdBy: author || 'csv-import',
      createdAt: now,
      updatedBy: 'csv-import',
      updatedAt: now,
      // Settlement fields
      author,
      budgetSubCategory: budgetSubCategory || undefined,
      budgetSubSubCategory: budgetSubSubCategory || undefined,
      evidenceRequiredDesc: pickValue(kv, ['필수증빙자료 리스트', 'evidenceRequiredDesc']) || undefined,
      evidenceCompletedDesc: pickValue(kv, ['실제 구비 완료된 증빙자료 리스트', 'evidenceCompletedDesc']) || undefined,
      evidencePendingDesc: pickValue(kv, ['준비필요자료', 'evidencePendingDesc']) || undefined,
      evidenceDriveLink: pickValue(kv, ['증빙자료 드라이브', 'evidenceDriveLink']) || undefined,
      supportPendingDocs: pickValue(kv, ['준비 필요자료', 'supportPendingDocs']) || undefined,
      eNaraRegistered: pickValue(kv, ['e나라 등록', 'eNaraRegistered']) || undefined,
      eNaraExecuted: pickValue(kv, ['e나라 집행', 'eNaraExecuted']) || undefined,
      vatSettlementDone: /Y|yes|완료|true/i.test(pickValue(kv, ['부가세 지결 완료여부', 'vatSettlementDone'])) || undefined,
      settlementComplete: /Y|yes|완료|true/i.test(pickValue(kv, ['최종완료', 'settlementComplete'])) || undefined,
      settlementNote: pickValue(kv, ['비고', 'settlementNote', 'note']) || undefined,
    };

    valid.push(tx);
  }

  return { valid, errors, warnings };
}

// ── Import Editor helpers ──

export interface ImportRow {
  tempId: string;
  sourceTxId?: string;
  /** Cell values aligned to SETTLEMENT_COLUMNS order (string representation). */
  cells: string[];
  /** Validation error when trying to parse this row. */
  error?: string;
}

/**
 * Normalize a CSV matrix into editable ImportRow[] aligned with SETTLEMENT_COLUMNS.
 * Handles different column orders and extra/missing columns via header matching.
 */
export function normalizeMatrixToImportRows(matrix: string[][]): ImportRow[] {
  if (matrix.length < 2) return [];

  const headerRowIdx = findHeaderRowIdx(matrix);

  const headers = matrix[headerRowIdx].map((h) => normalizeSpace(h));
  const dataRows = matrix.slice(headerRowIdx + 1);

  // Build mapping: SETTLEMENT_COLUMNS index → source CSV column index
  const colMapping: (number | -1)[] = SETTLEMENT_COLUMNS.map((col) => {
    const target = normalizeKey(col.csvHeader);
    for (let j = 0; j < headers.length; j++) {
      const src = normalizeKey(headers[j]);
      if (src === target || src.includes(target) || target.includes(src)) return j;
    }
    return -1;
  });

  const rows: ImportRow[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const raw = dataRows[i];
    // Skip fully empty rows
    if (raw.every((c) => !c.trim())) continue;

    const cells = colMapping.map((srcIdx) =>
      srcIdx >= 0 ? normalizeSpace(raw[srcIdx] || '') : '',
    );

    // Auto-fill No. column
    const noIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.');
    if (noIdx >= 0) cells[noIdx] = String(rows.length + 1);

    rows.push({
      tempId: `imp-${Date.now()}-${i}`,
      cells,
    });
  }
  return rows;
}

/**
 * Create an empty ImportRow for manual row addition.
 */
export function createEmptyImportRow(): ImportRow {
  return {
    tempId: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cells: SETTLEMENT_COLUMNS.map(() => ''),
  };
}

/**
 * Convert existing transactions into ImportRow[] for editable sheet view.
 */
export function transactionsToImportRows(
  transactions: Transaction[],
  weeks: MonthMondayWeek[],
): ImportRow[] {
  const sorted = [...transactions].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  let rowNum = 0;

  return sorted.map((tx) => {
    rowNum++;
    const dateStr = tx.dateTime?.slice(0, 10) || '';
    const yearWeeks = dateStr ? getYearMondayWeeks(Number(dateStr.slice(0, 4))) : weeks;
    const weekLabel = dateStr ? findWeekForDate(dateStr, yearWeeks)?.label || '' : '';

    const cells = SETTLEMENT_COLUMNS.map((col) => {
      if (col.csvHeader === 'No.') return String(rowNum);
      if (col.csvHeader === '해당 주차') return weekLabel;
      if (col.csvHeader === '지출구분') return methodToLabel(tx.method);
      if (!col.txField) return '';
      return formatCellValue(getNestedValue(tx, col.txField), col.format);
    });

    return {
      tempId: tx.id,
      sourceTxId: tx.id,
      cells,
    };
  });
}

/**
 * Convert a single ImportRow to a Transaction.
 * Returns the transaction on success or an error message.
 */
export function importRowToTransaction(
  row: ImportRow,
  projectId: string,
  ledgerId: string,
  rowIndex: number,
): { transaction?: Transaction; error?: string } {
  // Build key-value map from column headers
  const kv: Record<string, string> = {};
  for (let j = 0; j < SETTLEMENT_COLUMNS.length; j++) {
    const header = SETTLEMENT_COLUMNS[j].csvHeader;
    kv[header] = row.cells[j] || '';
  }

  const dateRaw = pickValue(kv, ['거래일시', '거래일', 'dateTime']);
  const amountRaw = pickValue(kv, ['통장에 찍힌 입/출금액', '입출금액', 'bankAmount', '금액']);
  const isEffectivelyEmpty = Object.entries(kv).every(([header, value]) => {
    if (header === 'No.' || header === '해당 주차') return true;
    return !value;
  });
  if (isEffectivelyEmpty) return {};

  const datePart = dateRaw ? normalizeSpace(dateRaw).split(/\s+/)[0].replace(/\./g, '-') : '';
  const dateTime = datePart ? parseDate(datePart) : '';
  if (dateRaw && !dateTime) return { error: '거래일시를 파싱할 수 없습니다' };

  const bankAmount = parseNumber(amountRaw) ?? 0;
  const methodRaw = pickValue(kv, ['지출구분', '결제수단', 'method']);
  const method = labelToMethod(methodRaw);

  const budgetCategory = pickValue(kv, ['비목', 'budgetCategory']);
  const budgetSubCategory = pickValue(kv, ['세목', 'budgetSubCategory']);
  const budgetSubSubCategory = pickValue(kv, ['세세목', 'budgetSubSubCategory']);

  const cashflowLabelRaw = pickValue(kv, ['cashflow항목', 'cashflowLabel', 'cashflow']);
  const lineId = parseCashflowLineLabel(cashflowLabelRaw);
  const direction = inferDirection(lineId);
  const cashflowLabel = lineId ? getCashflowLineLabelForExport(lineId) : cashflowLabelRaw;

  const balanceAfter = parseNumber(pickValue(kv, ['통장잔액', 'balanceAfter'])) ?? 0;
  const depositAmount = parseNumber(pickValue(kv, ['입금액', 'depositAmount'])) ?? 0;
  const vatRefund = parseNumber(pickValue(kv, ['매입부가세 반환', 'vatRefund'])) ?? 0;
  const expenseAmount = parseNumber(pickValue(kv, ['사업비 사용액', 'expenseAmount'])) ?? 0;
  const vatIn = parseNumber(pickValue(kv, ['매입부가세', 'vatIn'])) ?? 0;

  const counterparty = pickValue(kv, ['지급처', '거래처', 'counterparty']);
  const memo = pickValue(kv, ['상세 적요', '적요', 'memo']);
  const author = pickValue(kv, ['작성자', 'author']);

  const now = new Date().toISOString();
  const id = row.sourceTxId || `stl-${stableHash(`${projectId}|${dateTime}|${counterparty}|${bankAmount}|${rowIndex}`)}`;
  const cashflowCategory = inferCashflowCategory(lineId, direction);

  const tx: Transaction = {
    id,
    ledgerId,
    projectId,
    state: 'DRAFT',
    dateTime,
    weekCode: '',
    direction,
    method,
    cashflowCategory,
    cashflowLabel,
    budgetCategory: budgetCategory || undefined,
    counterparty,
    memo,
    amounts: {
      bankAmount,
      depositAmount,
      expenseAmount,
      vatIn,
      vatOut: 0,
      vatRefund,
      balanceAfter,
    },
    evidenceRequired: [],
    evidenceStatus: 'MISSING',
    evidenceMissing: [],
    attachmentsCount: 0,
    createdBy: author || 'csv-import',
    createdAt: now,
    updatedBy: 'csv-import',
    updatedAt: now,
    author,
    budgetSubCategory: budgetSubCategory || undefined,
    budgetSubSubCategory: budgetSubSubCategory || undefined,
    evidenceRequiredDesc: pickValue(kv, ['필수증빙자료 리스트', 'evidenceRequiredDesc']) || undefined,
    evidenceCompletedDesc: pickValue(kv, ['실제 구비 완료된 증빙자료 리스트', 'evidenceCompletedDesc']) || undefined,
    evidencePendingDesc: pickValue(kv, ['준비필요자료', 'evidencePendingDesc']) || undefined,
    evidenceDriveLink: pickValue(kv, ['증빙자료 드라이브', 'evidenceDriveLink']) || undefined,
    supportPendingDocs: pickValue(kv, ['준비 필요자료', 'supportPendingDocs']) || undefined,
    eNaraRegistered: pickValue(kv, ['e나라 등록', 'eNaraRegistered']) || undefined,
    eNaraExecuted: pickValue(kv, ['e나라 집행', 'eNaraExecuted']) || undefined,
    vatSettlementDone: /Y|yes|완료|true/i.test(pickValue(kv, ['부가세 지결 완료여부', 'vatSettlementDone'])) || undefined,
    settlementComplete: /Y|yes|완료|true/i.test(pickValue(kv, ['최종완료', 'settlementComplete'])) || undefined,
    settlementNote: pickValue(kv, ['비고', 'settlementNote', 'note']) || undefined,
  };

  return { transaction: tx };
}

// ── Helpers (internal) ──

// Map CashflowSheetLineId to a CashflowCategory for store compatibility
function inferCashflowCategory(
  lineId: CashflowSheetLineId | undefined,
  direction: Direction,
): Transaction['cashflowCategory'] {
  if (!lineId) return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  switch (lineId) {
    case 'MYSC_PREPAY_IN': return 'CONTRACT_PAYMENT';
    case 'SALES_IN': return 'CONTRACT_PAYMENT';
    case 'SALES_VAT_IN': return 'VAT_REFUND';
    case 'TEAM_SUPPORT_IN': return 'MISC_INCOME';
    case 'BANK_INTEREST_IN': return 'MISC_INCOME';
    case 'DIRECT_COST_OUT': return 'OUTSOURCING';
    case 'INPUT_VAT_OUT': return 'TAX_PAYMENT';
    case 'MYSC_LABOR_OUT': return 'LABOR_COST';
    case 'MYSC_PROFIT_OUT': return 'MISC_EXPENSE';
    case 'SALES_VAT_OUT': return 'TAX_PAYMENT';
    case 'TEAM_SUPPORT_OUT': return 'MISC_EXPENSE';
    case 'BANK_INTEREST_OUT': return 'MISC_EXPENSE';
    default: return direction === 'IN' ? 'MISC_INCOME' : 'MISC_EXPENSE';
  }
}
