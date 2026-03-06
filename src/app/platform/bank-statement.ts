import { normalizeKey, normalizeSpace, parseDate, parseNumber, stableHash } from './csv-utils';
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

function pickAmount(cells: string[], amountIdxs: number[]): number | null {
  let fallback: number | null = null;
  for (const idx of amountIdxs) {
    const raw = String(cells[idx] || '');
    if (!isAmountLiteral(raw)) continue;
    const n = parseNumber(raw);
    if (n == null) continue;
    if (fallback == null) fallback = n;
    if (n !== 0) return n;
  }
  return fallback;
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
  const idxBankAmount = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장에 찍힌 입/출금액');
  const idxBalance = SETTLEMENT_COLUMNS.findIndex((c) => c.csvHeader === '통장잔액');

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

    if (idxBankAmount >= 0 && amountIdxs.length > 0) {
      const amount = pickAmount(rowCells, amountIdxs);
      cells[idxBankAmount] = amount != null ? amount.toLocaleString('ko-KR') : '';
    }

    if (idxBalance >= 0 && balanceIdx >= 0) {
      const rawBal = String(rowCells[balanceIdx] || '');
      const bal = isAmountLiteral(rawBal) ? parseNumber(rawBal) : null;
      cells[idxBalance] = bal != null ? bal.toLocaleString('ko-KR') : normalizeSpace(String(rowCells[balanceIdx] || ''));
    }

    const sourceKey = stableHash([
      rawDate,
      idxCounterparty >= 0 ? String(cells[idxCounterparty] || '') : '',
      idxBankAmount >= 0 ? String(cells[idxBankAmount] || '') : '',
    ].join('|'));

    nextRows.push({
      ...base,
      tempId: base.tempId || `bank-${sourceKey}`,
      sourceTxId: `bank:${sourceKey}`,
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

function normalizeImportRow(row: ImportRow): ImportRow {
  return {
    tempId: row.tempId || `imp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    cells: Array.isArray(row.cells)
      ? SETTLEMENT_COLUMNS.map((_, i) => normalizeSpace(String(row.cells[i] ?? '')))
      : SETTLEMENT_COLUMNS.map(() => ''),
  };
}

/**
 * Merge new bank-mapped rows into existing expense sheet rows.
 * - Rebuild rows from latest mapped bank rows (snapshot-style).
 * - Keep manual fields from matched existing rows.
 * - Drop unmatched existing rows so upload does not append forever.
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

  const pickIndexFallback = (idx: number): ImportRow | undefined => {
    const candidate = existing[idx];
    if (!candidate || usedExisting.has(candidate)) return undefined;
    return candidate;
  };

  const merged: ImportRow[] = [];
  for (const [idx, mappedRow] of mapped.entries()) {
    const source = String(mappedRow.sourceTxId || '').trim();
    const key = rowKey(mappedRow);
    const matchedExisting = (
      (source ? takeFromBucket(existingBySourceBuckets.get(source)) : undefined)
      || (key ? takeFromBucket(existingByKeyBuckets.get(key)) : undefined)
      || pickIndexFallback(idx)
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
