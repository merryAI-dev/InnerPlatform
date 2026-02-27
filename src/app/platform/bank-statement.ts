import { normalizeSpace, parseDate, parseNumber, stableHash } from './csv-utils';
import { findWeekForDate, getYearMondayWeeks } from './cashflow-weeks';
import { SETTLEMENT_COLUMNS, createEmptyImportRow, type ImportRow } from './settlement-csv';

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

export type BankStatementColumn = (typeof BANK_STATEMENT_COLUMNS)[number];

export interface BankStatementRow {
  tempId: string;
  cells: string[];
}

function normalizeHeader(value: string): string {
  return normalizeSpace(value).replace(/\s+/g, '');
}

export function normalizeBankStatementMatrix(matrix: string[][]): {
  columns: string[];
  rows: BankStatementRow[];
} {
  if (!matrix.length) {
    return { columns: [...BANK_STATEMENT_COLUMNS], rows: [] };
  }

  const headerIdx = matrix.findIndex((row) => {
    const set = row.map((v) => normalizeHeader(String(v || '')));
    return set.includes(normalizeHeader('거래일시')) && (set.includes(normalizeHeader('입금금액')) || set.includes(normalizeHeader('출금금액')));
  });

  const headerRow = headerIdx >= 0 ? matrix[headerIdx] : [];
  const headerNorm = headerRow.map((v) => normalizeHeader(String(v || '')));

  const indexByColumn = BANK_STATEMENT_COLUMNS.map((label) => {
    const key = normalizeHeader(label);
    return headerNorm.findIndex((h) => h === key);
  });

  const rows: BankStatementRow[] = [];
  for (let i = headerIdx >= 0 ? headerIdx + 1 : 0; i < matrix.length; i++) {
    const line = matrix[i] || [];
    if (line.every((v) => !normalizeSpace(String(v || '')))) continue;
    const cells = BANK_STATEMENT_COLUMNS.map((_, colIdx) => {
      const srcIdx = indexByColumn[colIdx];
      const raw = srcIdx >= 0 ? line[srcIdx] : '';
      return normalizeSpace(String(raw ?? ''));
    });
    rows.push({ tempId: `bank-${i + 1}`, cells });
  }

  return { columns: [...BANK_STATEMENT_COLUMNS], rows };
}

export function mapBankStatementsToImportRows(
  bankRows: BankStatementRow[],
): ImportRow[] {
  const idxDate = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '거래일시');
  const idxWeek = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '해당 주차');
  const idxCounterparty = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지급처');
  const idxMethod = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '지출구분');
  const idxBankAmount = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
  const idxBalance = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액');
  const idxMemo = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '상세 적요');

  const bankIdxDate = BANK_STATEMENT_COLUMNS.indexOf('거래일시');
  const bankIdxSummary = BANK_STATEMENT_COLUMNS.indexOf('적요');
  const bankIdxCounterparty = BANK_STATEMENT_COLUMNS.indexOf('의뢰인/수취인');
  const bankIdxNote = BANK_STATEMENT_COLUMNS.indexOf('내통장표시내용');
  const bankIdxOut = BANK_STATEMENT_COLUMNS.indexOf('출금금액');
  const bankIdxIn = BANK_STATEMENT_COLUMNS.indexOf('입금금액');
  const bankIdxBalance = BANK_STATEMENT_COLUMNS.indexOf('잔액');

  function normalizeDate(raw: string): string {
    const value = normalizeSpace(raw).replace(/\./g, '-');
    return value.replace(/\s+/g, ' ');
  }

  function mapMethod(summary: string): string {
    const s = normalizeSpace(summary);
    if (s === '체크카드') return '법인카드';
    if (s === '인터넷출금이체') return '계좌이체';
    return '';
  }

  const nextRows: ImportRow[] = [];

  for (const bankRow of bankRows) {
    const dateRaw = bankIdxDate >= 0 ? bankRow.cells[bankIdxDate] : '';
    const datePart = normalizeSpace(dateRaw).split(/\s+/)[0];
    let dateIso = parseDate(datePart);
    if (!dateIso) {
      const m = datePart.match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
      if (m) {
        dateIso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      }
    }
    const summary = bankIdxSummary >= 0 ? bankRow.cells[bankIdxSummary] : '';
    const counterparty = bankIdxCounterparty >= 0 ? bankRow.cells[bankIdxCounterparty] : '';
    const note = bankIdxNote >= 0 ? bankRow.cells[bankIdxNote] : '';
    const outRaw = bankIdxOut >= 0 ? bankRow.cells[bankIdxOut] : '';
    const inRaw = bankIdxIn >= 0 ? bankRow.cells[bankIdxIn] : '';
    const balanceRaw = bankIdxBalance >= 0 ? bankRow.cells[bankIdxBalance] : '';

    const outAmount = parseNumber(String(outRaw)) ?? 0;
    const inAmount = parseNumber(String(inRaw)) ?? 0;
    const bankAmount = inAmount > 0 ? inAmount : outAmount;

    const key = stableHash([dateRaw, summary, counterparty, String(inAmount), String(outAmount)].join('|'));
    const sourceTxId = `bank:${key}`;

    const base = createEmptyImportRow();
    base.sourceTxId = sourceTxId;
    base.tempId = base.tempId || `bank-${key}`;

    const cells = [...base.cells];
    if (idxDate >= 0) cells[idxDate] = normalizeDate(dateRaw);
    if (idxWeek >= 0 && dateIso) {
      const year = Number.parseInt(dateIso.slice(0, 4), 10);
      const weeks = getYearMondayWeeks(Number.isFinite(year) ? year : new Date().getFullYear());
      cells[idxWeek] = findWeekForDate(dateIso, weeks)?.label || '';
    }
    if (idxCounterparty >= 0) cells[idxCounterparty] = counterparty;
    if (idxMethod >= 0) cells[idxMethod] = mapMethod(summary);
    if (idxBankAmount >= 0) cells[idxBankAmount] = bankAmount ? bankAmount.toLocaleString('ko-KR') : '';
    if (idxBalance >= 0) {
      const bal = parseNumber(String(balanceRaw)) ?? null;
      cells[idxBalance] = bal != null ? bal.toLocaleString('ko-KR') : normalizeSpace(String(balanceRaw || ''));
    }
    if (idxMemo >= 0 && (note || summary)) cells[idxMemo] = note || summary;

    const merged: ImportRow = { ...base, cells };
    nextRows.push(merged);
  }

  // Re-number No. column
  const noIdx = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === 'No.');
  if (noIdx >= 0) {
    nextRows.forEach((row, i) => {
      row.cells[noIdx] = String(i + 1);
    });
  }

  return nextRows;
}
