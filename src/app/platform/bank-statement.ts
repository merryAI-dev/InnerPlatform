import { normalizeKey, normalizeSpace, parseDate, parseNumber } from './csv-utils';
import { findWeekForDate, getYearMondayWeeks } from './cashflow-weeks';
import { SETTLEMENT_COLUMNS, createEmptyImportRow, parseCashflowLineLabel, type ImportRow } from './settlement-csv';
import type {
  BankImportIntakeItem,
  BankImportManualFields,
  BankImportSnapshot,
  CashflowCategory,
  EvidenceStatus,
  SettlementEntryKind,
} from '../data/types';
import {
  buildBankFingerprint,
  resolveBankImportMatchState,
  resolveBankImportProjectionStatus,
} from './bank-import-triage';
import { mapCashflowLineToCategory } from './bank-import-cashflow';

// ── HTML-as-XLS parsing (KB, 신한 등 HTML 형식 은행 엑셀) ──

/** Detect if raw file bytes look like HTML rather than real XLS/XLSX. */
export function isHtmlMaskedAsXls(headText: string): boolean {
  const trimmed = headText.trim();
  return /^<(!DOCTYPE|html|meta|style|table)/i.test(trimmed) || trimmed.includes('<table');
}

/** Extract text content from an HTML string, stripping all tags. */
function htmlTextContent(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

/** Extract all <table>...</table> blocks from HTML (non-greedy, handles nesting via iteration). */
function extractTables(html: string): string[] {
  const tables: string[] = [];
  const re = /<table[\s>]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const start = m.index;
    // Find the matching </table> — track nesting depth
    let depth = 1;
    let pos = start + m[0].length;
    while (depth > 0 && pos < html.length) {
      const openIdx = html.indexOf('<table', pos);
      const closeIdx = html.indexOf('</table', pos);
      if (closeIdx === -1) break;
      if (openIdx !== -1 && openIdx < closeIdx) {
        depth++;
        pos = openIdx + 6;
      } else {
        depth--;
        if (depth === 0) {
          const endTag = html.indexOf('>', closeIdx);
          tables.push(html.slice(start, endTag + 1));
        }
        pos = closeIdx + 8;
      }
    }
  }
  return tables;
}

/** Extract rows from a single <table> HTML string. */
function parseTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[\s>][\s\S]*?<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const tdRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRe.exec(trMatch[0])) !== null) {
      const attrs = tdMatch[1] || '';
      const text = htmlTextContent(tdMatch[2] || '');
      const colspanM = attrs.match(/colspan\s*=\s*['"]?(\d+)/i);
      const colspan = Math.min(parseInt(colspanM?.[1] || '1', 10), 20);
      cells.push(text);
      for (let i = 1; i < colspan; i++) cells.push('');
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

/**
 * Parse HTML-formatted bank export into a matrix (regex-based, no DOM dependency).
 * Strategy: find the table with the most rows + transaction keywords.
 * Handles nested tables (KB), metadata header tables (신한), and colspan.
 */
export function parseHtmlBankExport(html: string): string[][] {
  const tables = extractTables(html);
  if (tables.length === 0) return [];

  let bestRows: string[][] = [];
  let bestScore = -1;

  for (const tableHtml of tables) {
    const rows = parseTableRows(tableHtml);
    if (rows.length < 2) continue;

    const text = htmlTextContent(tableHtml);
    let score = rows.length;
    if (/거래일|일시|날짜/.test(text)) score += 10;
    if (/입금|출금|잔액/.test(text)) score += 10;
    // Penalty for metadata tables (few columns)
    if (rows[0] && rows[0].filter(Boolean).length <= 2) score -= 5;

    if (score > bestScore) {
      bestScore = score;
      bestRows = rows;
    }
  }

  if (bestRows.length === 0) return [];

  // Normalize column count
  const maxCols = Math.max(...bestRows.map((r) => r.length), 0);
  return bestRows.map((r) => {
    while (r.length < maxCols) r.push('');
    return r;
  });
}

/**
 * Post-process HTML-parsed matrix: strip residual HTML entities,
 * normalize whitespace, and remove rows that look like HTML artifacts.
 */
export function sanitizeHtmlMatrix(matrix: string[][]): string[][] {
  return matrix
    .map((row) =>
      row.map((cell) =>
        cell
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    )
    .filter((row) => {
      // Remove rows that are all empty or look like HTML noise
      const nonEmpty = row.filter(Boolean);
      if (nonEmpty.length === 0) return false;
      // Remove rows where any cell still contains HTML tags
      return !nonEmpty.some((cell) => /<[a-z/]/i.test(cell));
    });
}

export const BANK_STATEMENT_COLUMNS = [
  '통장번호',
  '거래일시',
  '적요',
  '의뢰인/수취인',
  '내통장표시내용',
  '출금금액',
  '입금금액',
  '잔액',
  '취급점',
  '구분',
] as const;

export type BankStatementProfile = 'hana' | 'kb' | 'shinhan' | 'generic';

export function getBankStatementProfileLabel(profile: BankStatementProfile): string {
  switch (profile) {
    case 'hana':
      return '하나은행';
    case 'kb':
      return '국민은행';
    case 'shinhan':
      return '신한은행';
    default:
      return '일반 형식';
  }
}

export interface BankStatementRow {
  tempId: string;
  cells: string[];
}

export interface BankStatementSheet {
  columns: string[];
  rows: BankStatementRow[];
}

function cleanHeader(value: string): string {
  return normalizeKey(value);
}

function normalizeHeaderCells(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((cell, i) => {
    const trimmed = normalizeSpace(String(cell || ''));
    const base = trimmed || `컬럼${i + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base}_${n}`;
      n += 1;
    }
    used.add(name);
    return name;
  });
}

function shouldExcludeUploadColumn(header: string): boolean {
  const key = cleanHeader(header);
  if (!key) return false;
  return key.includes(cleanHeader('출금내용')) || key.includes(cleanHeader('입금내용'));
}

function hasAnyKeyword(header: string, keywords: string[]): boolean {
  const key = cleanHeader(header);
  if (!key) return false;
  return keywords.some((kw) => {
    const target = cleanHeader(kw);
    return target ? key.includes(target) : false;
  });
}

function scoreHeaderRow(row: string[]): number {
  const values = row.map((v) => normalizeSpace(String(v || '')));
  const nonEmpty = values.filter(Boolean).length;
  if (nonEmpty === 0) return -1;
  const hasDate = values.some((v) => hasAnyKeyword(v, ['거래일자', '거래일시', '거래일', '날짜', 'date']));
  const hasAmount = values.some((v) => hasAnyKeyword(v, ['입금', '출금', '입출금', '잔액', 'amount']));
  if (!hasDate || !hasAmount) return -1;
  return nonEmpty;
}

function findHeaderIndex(matrix: string[][]): number {
  let bestIdx = -1;
  let bestScore = -1;
  for (let i = 0; i < matrix.length; i++) {
    const score = scoreHeaderRow(matrix[i] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0) return bestIdx;
  return matrix.findIndex((row) => (row || []).some((cell) => normalizeSpace(String(cell || ''))));
}

function findFirstHeaderIndex(columns: string[], aliases: string[]): number {
  const normalized = columns.map((c) => cleanHeader(c));
  for (const alias of aliases) {
    const key = cleanHeader(alias);
    const idx = normalized.findIndex((h) => h === key);
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    if (aliases.some((alias) => h.includes(cleanHeader(alias)))) return i;
  }
  return -1;
}

function findHeaderIndicesByAliases(columns: string[], aliases: string[]): number[] {
  const normalized = columns.map((c) => cleanHeader(c));
  const keys = aliases.map((a) => cleanHeader(a)).filter(Boolean);
  const matched: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    if (!h) continue;
    if (keys.some((key) => h === key || h.includes(key) || key.includes(h))) {
      matched.push(i);
    }
  }
  return matched;
}

function findHeaderIndicesByKeyword(columns: string[], keyword: string): number[] {
  const target = cleanHeader(keyword);
  if (!target) return [];
  const indices: number[] = [];
  columns.forEach((col, idx) => {
    const key = cleanHeader(col);
    if (key.includes(target)) indices.push(idx);
  });
  return indices;
}

export function detectBankStatementProfile(columns: string[], fileName = ''): BankStatementProfile {
  const joined = [
    ...columns.map((col) => cleanHeader(col)),
    cleanHeader(fileName),
  ].join(' ');

  if (joined.includes(cleanHeader('하나')) || joined.includes(cleanHeader('keb')) || joined.includes(cleanHeader('hana'))) {
    return 'hana';
  }
  if (joined.includes(cleanHeader('국민')) || joined.includes(cleanHeader('kb'))) {
    return 'kb';
  }
  if (joined.includes(cleanHeader('신한')) || joined.includes(cleanHeader('shinhan'))) {
    return 'shinhan';
  }
  return 'generic';
}

function parseDateOnly(raw: string): string {
  const value = normalizeSpace(raw);
  if (!value) return '';
  const datePart = value.split(/\s+/)[0].replace(/\./g, '-');
  const parsed = parseDate(datePart);
  if (parsed) return parsed;
  const m = value.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function isAmountLiteral(raw: string): boolean {
  const value = normalizeSpace(String(raw || ''));
  if (!value) return false;
  // Allow only numeric amount characters (currency/commas/sign/parentheses).
  return /^[₩원0-9,\.\-\+\(\)\s]+$/.test(value);
}

function isSummaryRow(cells: string[]): boolean {
  const summaryKeywords = ['총계', '합계', '소계', '누계'];
  const nonEmpty = cells.map((v) => normalizeSpace(String(v || ''))).filter(Boolean);
  if (nonEmpty.length === 0) return true;
  const hasSummaryWord = nonEmpty.some((v) => {
    const key = cleanHeader(v);
    return summaryKeywords.some((kw) => {
      const target = cleanHeader(kw);
      return key === target || key.includes(target);
    });
  });
  if (!hasSummaryWord) return false;
  const hasDate = nonEmpty.some((v) => parseDateOnly(v) !== '');
  return !hasDate;
}

function resolveAmountColumnIndices(columns: string[], rows: BankStatementRow[]): number[] {
  const excludeWords = ['내용', '적요', '메모', '내역', '거래처', '수취인', '의뢰인'];
  const candidates = Array.from(new Set([
    ...findHeaderIndicesByKeyword(columns, '입금'),
    ...findHeaderIndicesByKeyword(columns, '출금'),
    ...findHeaderIndicesByKeyword(columns, '입출금'),
  ])).filter((idx) => {
    const key = cleanHeader(columns[idx] || '');
    if (!key) return false;
    return !excludeWords.some((word) => key.includes(cleanHeader(word)));
  });

  return candidates.filter((idx) => {
    let nonEmpty = 0;
    let amountLike = 0;
    for (const row of rows) {
      const raw = normalizeSpace(String(row?.cells?.[idx] ?? ''));
      if (!raw) continue;
      nonEmpty += 1;
      if (isAmountLiteral(raw) && parseNumber(raw) != null) amountLike += 1;
    }
    if (nonEmpty === 0) return false;
    return amountLike / nonEmpty >= 0.6;
  });
}

function inferEntryKindFromAmountCell(header: string, raw: string, parsed: number): SettlementEntryKind | undefined {
  const key = cleanHeader(header);
  const value = normalizeSpace(raw);
  const hasParens = /^\(.*\)$/.test(value);
  const isNegativeLiteral = /^-/.test(value) || hasParens || parsed < 0;

  if (key.includes(cleanHeader('출금'))) return 'EXPENSE';
  if (key.includes(cleanHeader('입금'))) return 'DEPOSIT';
  if (key.includes(cleanHeader('입출금'))) {
    if (isNegativeLiteral) return 'EXPENSE';
    if (parsed > 0) return 'DEPOSIT';
  }
  if (isNegativeLiteral) return 'EXPENSE';
  return undefined;
}

function pickAmount(
  cells: string[],
  amountIdxs: number[],
  columns: string[],
): { amount: number | null; entryKind?: SettlementEntryKind } {
  let fallback: { amount: number; entryKind?: SettlementEntryKind } | null = null;
  for (const idx of amountIdxs) {
    const raw = String(cells[idx] || '');
    if (!isAmountLiteral(raw)) continue;
    const n = parseNumber(raw);
    if (n == null) continue;
    const entryKind = inferEntryKindFromAmountCell(columns[idx] || '', raw, n);
    const amount = Math.abs(n);
    if (fallback == null) fallback = { amount, entryKind };
    if (n !== 0) return { amount, entryKind };
  }
  return fallback || { amount: null };
}

function inferCashflowCategoryFromLineLabel(rawLineLabel: string, signedAmount: number): CashflowCategory | undefined {
  const lineId = parseCashflowLineLabel(rawLineLabel);
  return mapCashflowLineToCategory(lineId, signedAmount >= 0 ? 'IN' : 'OUT');
}

function resolveEvidenceStatusFromExpenseRow(row: ImportRow | null | undefined): EvidenceStatus {
  if (!row) return 'MISSING';
  const completedIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '실제 구비 완료된 증빙자료 리스트');
  const pendingIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '준비필요자료');
  const completed = completedIdx >= 0 ? normalizeSpace(String(row.cells[completedIdx] || '')) : '';
  const pending = pendingIdx >= 0 ? normalizeSpace(String(row.cells[pendingIdx] || '')) : '';
  if (completed && !pending) return 'COMPLETE';
  if (completed || pending) return 'PARTIAL';
  return 'MISSING';
}

function extractManualFieldsFromExpenseRow(row: ImportRow | null | undefined): BankImportManualFields {
  if (!row) return {};
  const expenseAmountIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '사업비 사용액');
  const budgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비목');
  const subBudgetIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '세목');
  const cashflowIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === 'cashflow항목');
  const noteIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '비고');
  const completedIdx = SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '실제 구비 완료된 증빙자료 리스트');
  const signedAmount = parseNumber(String(row.cells[SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === '통장에 찍힌 입/출금액')] || '')) || 0;

  const manualFields: BankImportManualFields = {};
  const expenseAmount = expenseAmountIdx >= 0 ? parseNumber(String(row.cells[expenseAmountIdx] || '')) : null;
  if (expenseAmount != null) manualFields.expenseAmount = expenseAmount;
  if (budgetIdx >= 0) {
    const value = normalizeSpace(String(row.cells[budgetIdx] || ''));
    if (value) manualFields.budgetCategory = value;
  }
  if (subBudgetIdx >= 0) {
    const value = normalizeSpace(String(row.cells[subBudgetIdx] || ''));
    if (value) manualFields.budgetSubCategory = value;
  }
  if (cashflowIdx >= 0) {
    const value = normalizeSpace(String(row.cells[cashflowIdx] || ''));
    const lineId = parseCashflowLineLabel(value);
    const category = inferCashflowCategoryFromLineLabel(value, signedAmount);
    if (lineId) manualFields.cashflowLineId = lineId;
    if (category) manualFields.cashflowCategory = category;
  }
  if (noteIdx >= 0) {
    const value = normalizeSpace(String(row.cells[noteIdx] || ''));
    if (value) manualFields.memo = value;
  }
  if (completedIdx >= 0) {
    manualFields.evidenceCompletedDesc = String(row.cells[completedIdx] || '');
  }
  return manualFields;
}

function resolveBankSnapshotFromStatementRow(
  sheet: BankStatementSheet,
  bankRow: BankStatementRow,
): BankImportSnapshot | null {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const allRows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const rowCells = Array.isArray(bankRow.cells) ? bankRow.cells : [];
  const accountIdx = findFirstHeaderIndex(columns, ['통장번호', '계좌번호', '계좌']);
  const dateIdx = findFirstHeaderIndex(columns, ['거래일자', '거래일시', '거래일', '일자', '날짜', 'date']);
  const counterpartyIdxCandidates = (() => {
    const groups = [
      ['사용처', '가맹점', '상호', '거래처'],
      ['의뢰인/수취인', '의뢰인수취인', '수취인', '의뢰인', '상대계좌명'],
      ['내용', '거래내용'],
      ['적요', '메모'],
    ];
    const seen = new Set<number>();
    const ordered: number[] = [];
    groups.forEach((aliases) => {
      findHeaderIndicesByAliases(columns, aliases).forEach((idx) => {
        if (!seen.has(idx)) {
          seen.add(idx);
          ordered.push(idx);
        }
      });
    });
    return ordered;
  })();
  const memoIdxCandidates = findHeaderIndicesByAliases(columns, ['적요', '메모', '내용', '거래내용', '상세적요']);
  const balanceIdx = findFirstHeaderIndex(columns, ['잔액']);
  const amountIdxs = resolveAmountColumnIndices(columns, allRows);

  const rawDate = dateIdx >= 0
    ? String(rowCells[dateIdx] || '')
    : String(rowCells.find((value) => parseDateOnly(String(value || ''))) || '');
  const normalizedDateTime = parseDateOnly(rawDate) || normalizeSpace(rawDate);
  if (!normalizedDateTime) return null;

  let counterparty = '';
  for (const idx of counterpartyIdxCandidates) {
    const value = normalizeSpace(String(rowCells[idx] || ''));
    if (!value) continue;
    counterparty = value;
    break;
  }

  let memo = '';
  for (const idx of memoIdxCandidates) {
    const value = normalizeSpace(String(rowCells[idx] || ''));
    if (!value) continue;
    memo = value;
    break;
  }

  const resolvedAmount = pickAmount(rowCells, amountIdxs, columns);
  const signedAmount = resolvedAmount.amount == null
    ? 0
    : resolvedAmount.entryKind === 'DEPOSIT'
      ? resolvedAmount.amount
      : -Math.abs(resolvedAmount.amount);
  const balanceAfter = balanceIdx >= 0 ? (parseNumber(String(rowCells[balanceIdx] || '')) || 0) : 0;

  return {
    accountNumber: accountIdx >= 0 ? normalizeSpace(String(rowCells[accountIdx] || '')) : '',
    dateTime: normalizedDateTime,
    counterparty,
    memo,
    signedAmount,
    balanceAfter,
  };
}

export function normalizeBankStatementMatrix(matrix: string[][]): BankStatementSheet {
  if (!matrix.length) return { columns: [], rows: [] };
  const headerIdx = findHeaderIndex(matrix);
  if (headerIdx < 0) return { columns: [], rows: [] };

  const headerRaw = matrix[headerIdx] || [];
  const rawColumns = normalizeHeaderCells(headerRaw);
  const rawRows: BankStatementRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const line = matrix[i] || [];
    const cells = rawColumns.map((_, colIdx) => normalizeSpace(String(line[colIdx] ?? '')));
    if (cells.every((v) => !v)) continue;
    if (isSummaryRow(cells)) continue;
    rawRows.push({ tempId: `bank-${i + 1}`, cells });
  }

  const keepIndices = rawColumns
    .map((_, idx) => idx)
    .filter((idx) => {
      if (shouldExcludeUploadColumn(rawColumns[idx])) return false;
      return rawRows.some((row) => normalizeSpace(String(row.cells[idx] || '')) !== '');
    });

  if (keepIndices.length === 0) return { columns: [], rows: [] };

  const columns = keepIndices.map((idx) => rawColumns[idx]);
  const rows = rawRows
    .map((row) => ({
      ...row,
      cells: keepIndices.map((idx) => normalizeSpace(String(row.cells[idx] ?? ''))),
    }))
    .filter((row) => row.cells.some((v) => v));

  return { columns, rows };
}

export function mapBankStatementsToImportRows(sheet: BankStatementSheet): ImportRow[] {
  const columns = Array.isArray(sheet.columns) ? sheet.columns : [];
  const bankRows = Array.isArray(sheet.rows) ? sheet.rows : [];

  const idxDate = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
  const idxWeek = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '해당 주차');
  const idxCounterparty = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지급처');
  const idxMemo = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '상세 적요');
  const idxBankAmount = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
  const idxBalance = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액');
  const idxDeposit = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '입금액(사업비,공급가액,은행이자)');

  const dateIdx = findFirstHeaderIndex(columns, ['거래일자', '거래일시', '거래일', '일자', '날짜', 'date']);
  const counterpartyIdxCandidates = (() => {
    const groups = [
      ['사용처', '가맹점', '상호', '거래처'],
      ['의뢰인/수취인', '의뢰인수취인', '수취인', '의뢰인', '상대계좌명'],
      ['내용', '거래내용'],
      ['적요', '메모'],
    ];
    const seen = new Set<number>();
    const ordered: number[] = [];
    groups.forEach((aliases) => {
      findHeaderIndicesByAliases(columns, aliases).forEach((idx) => {
        if (!seen.has(idx)) {
          seen.add(idx);
          ordered.push(idx);
        }
      });
    });
    return ordered;
  })();

  const balanceIdx = findFirstHeaderIndex(columns, ['잔액']);
  const memoIdxCandidates = findHeaderIndicesByAliases(columns, ['적요', '메모', '내용', '거래내용', '상세적요']);
  const amountIdxs = resolveAmountColumnIndices(columns, bankRows);

  const nextRows: ImportRow[] = [];
  for (const bankRow of bankRows) {
    const rowCells = Array.isArray(bankRow.cells) ? bankRow.cells : [];
    if (isSummaryRow(rowCells)) continue;

    const base = createEmptyImportRow();
    const cells = [...base.cells];

    const rawDate = dateIdx >= 0
      ? String(rowCells[dateIdx] || '')
      : String(rowCells.find((v) => parseDateOnly(String(v || ''))) || '');
    const dateOnly = parseDateOnly(rawDate);
    if (!dateOnly) continue;
    if (idxDate >= 0) cells[idxDate] = dateOnly;

    if (idxWeek >= 0 && dateOnly) {
      const year = Number.parseInt(dateOnly.slice(0, 4), 10);
      const weeks = getYearMondayWeeks(Number.isFinite(year) ? year : new Date().getFullYear());
      cells[idxWeek] = findWeekForDate(dateOnly, weeks)?.label || '';
    }

    if (idxCounterparty >= 0 && counterpartyIdxCandidates.length > 0) {
      let picked = '';
      for (const idx of counterpartyIdxCandidates) {
        const raw = String(rowCells[idx] || '');
        const normalized = normalizeSpace(raw);
        if (!normalized) continue;
        picked = normalized;
        break;
      }
      cells[idxCounterparty] = picked;
    }

    if (idxMemo >= 0 && memoIdxCandidates.length > 0) {
      let detail = '';
      for (const idx of memoIdxCandidates) {
        const raw = String(rowCells[idx] || '');
        const normalized = normalizeSpace(raw);
        if (!normalized) continue;
        detail = normalized;
        break;
      }
      cells[idxMemo] = detail;
    }

    let inferredEntryKind: SettlementEntryKind | undefined;
    if (idxBankAmount >= 0 && amountIdxs.length > 0) {
      const resolvedAmount = pickAmount(rowCells, amountIdxs, columns);
      inferredEntryKind = resolvedAmount.entryKind;
      cells[idxBankAmount] = resolvedAmount.amount != null ? resolvedAmount.amount.toLocaleString('ko-KR') : '';
      if (idxDeposit >= 0 && inferredEntryKind === 'DEPOSIT') {
        cells[idxDeposit] = resolvedAmount.amount != null ? resolvedAmount.amount.toLocaleString('ko-KR') : '';
      }
    }

    if (idxBalance >= 0 && balanceIdx >= 0) {
      const rawBal = String(rowCells[balanceIdx] || '');
      const bal = isAmountLiteral(rawBal) ? parseNumber(rawBal) : null;
      cells[idxBalance] = bal != null ? bal.toLocaleString('ko-KR') : normalizeSpace(String(rowCells[balanceIdx] || ''));
    }

    const bankSnapshot = resolveBankSnapshotFromStatementRow(sheet, bankRow);
    const sourceKey = bankSnapshot
      ? buildBankFingerprint(bankSnapshot)
      : `${bankRow.tempId}-${nextRows.length + 1}`;

    nextRows.push({
      ...base,
      tempId: base.tempId || `bank-${sourceKey}`,
      sourceTxId: `bank:${sourceKey}`,
      ...(inferredEntryKind ? { entryKind: inferredEntryKind } : {}),
      cells,
    });
  }

  const noIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.');
  if (noIdx >= 0) {
    nextRows.forEach((row, i) => {
      row.cells[noIdx] = String(i + 1);
    });
  }

  return nextRows;
}

export function buildBankImportIntakeItemsFromBankSheet(params: {
  projectId: string;
  sheet: BankStatementSheet;
  existingItems?: BankImportIntakeItem[] | null;
  existingRows?: ImportRow[] | null;
  existingExpenseSheetId?: string;
  lastUploadBatchId: string;
  now: string;
  updatedBy: string;
}): BankImportIntakeItem[] {
  const existingItems = Array.isArray(params.existingItems) ? params.existingItems : [];
  const existingRows = Array.isArray(params.existingRows) ? params.existingRows : [];
  const existingItemBySource = new Map(existingItems.map((item) => [item.sourceTxId, item] as const));
  const existingRowBySource = new Map(
    existingRows
      .filter((row) => normalizeSpace(String(row.sourceTxId || '')))
      .map((row) => [normalizeSpace(String(row.sourceTxId || '')), row] as const),
  );
  const duplicateCounts = new Map<string, number>();
  const snapshots = (Array.isArray(params.sheet.rows) ? params.sheet.rows : [])
    .map((row) => resolveBankSnapshotFromStatementRow(params.sheet, row))
    .filter((snapshot): snapshot is BankImportSnapshot => snapshot !== null);
  snapshots.forEach((snapshot) => {
    const fingerprint = buildBankFingerprint(snapshot);
    duplicateCounts.set(fingerprint, (duplicateCounts.get(fingerprint) || 0) + 1);
  });

  return snapshots.map((snapshot) => {
    const bankFingerprint = buildBankFingerprint(snapshot);
    const sourceTxId = `bank:${bankFingerprint}`;
    const existingItem = existingItemBySource.get(sourceTxId) || null;
    const existingRow = existingRowBySource.get(sourceTxId) || null;
    const manualFields = existingItem?.manualFields || extractManualFieldsFromExpenseRow(existingRow);
    const evidenceStatus = existingItem?.evidenceStatus || resolveEvidenceStatusFromExpenseRow(existingRow);
    const matchState = resolveBankImportMatchState({
      fingerprint: bankFingerprint,
      incomingSourceTxId: sourceTxId,
      bankSnapshot: snapshot,
      manualFields,
      existingItem,
      conflictingCandidateCount: duplicateCounts.get(bankFingerprint) || 0,
    });
    const projectionStatus = resolveBankImportProjectionStatus({
      matchState,
      manualFields,
      evidenceStatus,
    });
    const reviewReasons: string[] = [];
    if ((duplicateCounts.get(bankFingerprint) || 0) > 1) {
      reviewReasons.push('duplicate_fingerprint_in_upload');
    }
    if (matchState === 'REVIEW_REQUIRED' && reviewReasons.length === 0) {
      reviewReasons.push('manual_review_required');
    }

    return {
      id: existingItem?.id || bankFingerprint,
      projectId: params.projectId,
      sourceTxId,
      bankFingerprint,
      bankSnapshot: snapshot,
      matchState,
      projectionStatus,
      evidenceStatus,
      manualFields,
      ...(existingItem?.existingExpenseSheetId || params.existingExpenseSheetId
        ? { existingExpenseSheetId: existingItem?.existingExpenseSheetId || params.existingExpenseSheetId }
        : {}),
      ...(existingItem?.existingExpenseRowTempId || existingRow?.tempId
        ? { existingExpenseRowTempId: existingItem?.existingExpenseRowTempId || existingRow?.tempId }
        : {}),
      reviewReasons: existingItem && reviewReasons.length === 0 ? existingItem.reviewReasons : reviewReasons,
      lastUploadBatchId: params.lastUploadBatchId,
      createdAt: existingItem?.createdAt || params.now,
      updatedAt: params.now,
      updatedBy: params.updatedBy,
    };
  });
}

function normalizeImportRow(row: ImportRow): ImportRow {
  return {
    tempId: row.tempId || `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: Array.isArray(row.cells)
      ? SETTLEMENT_COLUMNS.map((_, i) => normalizeSpace(String(row.cells[i] ?? '')))
      : SETTLEMENT_COLUMNS.map(() => ''),
  };
}

/**
 * Merge new bank-mapped rows into existing expense sheet rows.
 * - Rebuild rows from latest mapped bank rows (snapshot-style).
 * - Keep manual fields from matched existing rows by identity only.
 * - Never rely on row order/index as a fallback matcher.
 */
export function mergeBankRowsIntoExpenseSheet(
  existingRows: ImportRow[] | null | undefined,
  mappedRows: ImportRow[],
): ImportRow[] {
  const existing = Array.isArray(existingRows) ? existingRows.map(normalizeImportRow) : [];
  const mapped = (Array.isArray(mappedRows) ? mappedRows : []).map(normalizeImportRow);

  const autoHeaders = [
    '거래일시',
    '해당 주차',
    '지급처',
    '통장에 찍힌 입/출금액',
    '통장잔액',
    '입금액(사업비,공급가액,은행이자)',
  ];
  const autoIdxs = autoHeaders
    .map((h) => SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === h))
    .filter((idx) => idx >= 0);
  const dateIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
  const counterpartyIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지급처');

  const rowKey = (row: ImportRow): string => {
    const d = dateIdx >= 0 ? normalizeSpace(String(row.cells[dateIdx] || '')) : '';
    const c = counterpartyIdx >= 0 ? normalizeSpace(String(row.cells[counterpartyIdx] || '')) : '';
    if (!d || !c) return '';
    return `${d}|${c}`;
  };

  const existingBySourceBuckets = new Map<string, ImportRow[]>();
  const existingByKeyBuckets = new Map<string, ImportRow[]>();
  const usedExisting = new Set<ImportRow>();
  for (const row of existing) {
    const source = String(row.sourceTxId || '').trim();
    const key = rowKey(row);
    if (source) {
      const bucket = existingBySourceBuckets.get(source) || [];
      bucket.push(row);
      existingBySourceBuckets.set(source, bucket);
    }
    if (key) {
      const bucket = existingByKeyBuckets.get(key) || [];
      bucket.push(row);
      existingByKeyBuckets.set(key, bucket);
    }
  }

  const takeFromBucket = (bucket: ImportRow[] | undefined): ImportRow | undefined => {
    if (!bucket || bucket.length === 0) return undefined;
    return bucket.find((row) => !usedExisting.has(row));
  };

  const merged: ImportRow[] = [];
  for (const mappedRow of mapped) {
    const source = String(mappedRow.sourceTxId || '').trim();
    const key = rowKey(mappedRow);
    const matchedExisting = (
      (source ? takeFromBucket(existingBySourceBuckets.get(source)) : undefined)
      || (key ? takeFromBucket(existingByKeyBuckets.get(key)) : undefined)
    );

    if (!matchedExisting) {
      merged.push(mappedRow);
      continue;
    }
    usedExisting.add(matchedExisting);
    const cells = [...matchedExisting.cells];
    for (const idx of autoIdxs) {
      cells[idx] = mappedRow.cells[idx] ?? '';
    }
    merged.push({
      ...matchedExisting,
      ...(mappedRow.sourceTxId ? { sourceTxId: mappedRow.sourceTxId } : {}),
      ...(mappedRow.entryKind ? { entryKind: mappedRow.entryKind } : {}),
      cells,
    });
  }

  const noIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.');
  if (noIdx >= 0) {
    merged.forEach((row, i) => {
      row.cells[noIdx] = String(i + 1);
    });
  }

  return merged;
}
