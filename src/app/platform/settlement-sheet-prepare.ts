import { SETTLEMENT_COLUMNS, type ImportRow } from './settlement-csv';
import type { Basis, SettlementSheetPolicy } from '../data/types';
import { buildBudgetLabelKey, normalizeBudgetLabel } from './budget-labels';
import {
  deriveSettlementRows,
  type SettlementDerivationContext,
} from './settlement-row-derivation';
import { resolveEvidenceRequiredByRules } from './evidence-rules';

function getColumnIndex(header: string): number {
  return SETTLEMENT_COLUMNS.findIndex((column) => column.csvHeader === header);
}

const NON_SUBSTANTIVE_SETTLEMENT_HEADERS = new Set([
  'No.',
  '해당 주차',
  '필수증빙자료 리스트',
  '실제 구비 완료된 증빙자료 리스트',
  '준비필요자료',
  '증빙자료 드라이브',
  '준비 필요자료',
]);

export function isSettlementRowMeaningful(row: ImportRow | null | undefined): boolean {
  if (!row) return false;
  return SETTLEMENT_COLUMNS.some((column, index) => {
    if (NON_SUBSTANTIVE_SETTLEMENT_HEADERS.has(column.csvHeader)) return false;
    return String(row.cells[index] ?? '').trim() !== '';
  });
}

export function pruneEmptySettlementRows(rows: ImportRow[] | null | undefined): ImportRow[] {
  if (!rows || rows.length === 0) return [];
  return rows.filter((row) => isSettlementRowMeaningful(row));
}

function normalizeImportRow(row: ImportRow, fallbackIndex: number): ImportRow {
  return {
    tempId: row.tempId || `sheet-import-${fallbackIndex + 1}`,
    ...(row.sourceTxId ? { sourceTxId: row.sourceTxId } : {}),
    ...(row.entryKind ? { entryKind: row.entryKind } : {}),
    cells: SETTLEMENT_COLUMNS.map((_, columnIndex) => String(row.cells[columnIndex] ?? '').normalize('NFC').trim()),
  };
}

function renumberRows(rows: ImportRow[]): ImportRow[] {
  const noIndex = getColumnIndex('No.');
  if (noIndex < 0) return rows;
  return rows.map((row, index) => {
    const nextNo = String(index + 1);
    if (row.cells[noIndex] === nextNo) return row;
    const cells = [...row.cells];
    cells[noIndex] = nextNo;
    return {
      ...row,
      cells,
    };
  });
}

export function resolveEvidenceRequiredDesc(
  map: Record<string, string> | undefined,
  budgetCode: string,
  subCode: string,
): string {
  if (!map) return '';
  const direct = map[`${budgetCode}|${subCode}`] || map[subCode] || map[budgetCode] || '';
  if (direct) return direct;
  const normBudget = normalizeBudgetLabel(budgetCode);
  const normSub = normalizeBudgetLabel(subCode);
  return map[buildBudgetLabelKey(normBudget, normSub)] || map[normSub] || map[normBudget] || '';
}

export function buildSettlementDerivationContext(
  projectId: string,
  defaultLedgerId: string,
  policy?: SettlementSheetPolicy,
  basis?: Basis,
): SettlementDerivationContext {
  return {
    projectId,
    defaultLedgerId,
    policy,
    basis,
    dateIdx: getColumnIndex('거래일시'),
    weekIdx: getColumnIndex('해당 주차'),
    depositIdx: getColumnIndex('입금액(사업비,공급가액,은행이자)'),
    refundIdx: getColumnIndex('매입부가세 반환'),
    expenseIdx: getColumnIndex('사업비 사용액'),
    vatInIdx: getColumnIndex('매입부가세'),
    bankAmountIdx: getColumnIndex('통장에 찍힌 입/출금액'),
    balanceIdx: getColumnIndex('통장잔액'),
    evidenceIdx: getColumnIndex('필수증빙자료 리스트'),
    evidenceCompletedIdx: getColumnIndex('실제 구비 완료된 증빙자료 리스트'),
    evidencePendingIdx: getColumnIndex('준비필요자료'),
  };
}

export function prepareSettlementImportRows(
  rows: ImportRow[] | null | undefined,
  options: {
    projectId: string;
    defaultLedgerId: string;
    evidenceRequiredMap?: Record<string, string>;
    policy?: SettlementSheetPolicy;
    basis?: Basis;
  },
): ImportRow[] {
  const nonEmptyRows = pruneEmptySettlementRows(rows);
  if (nonEmptyRows.length === 0) return [];

  const budgetCodeIdx = getColumnIndex('비목');
  const subCodeIdx = getColumnIndex('세목');
  const evidenceIdx = getColumnIndex('필수증빙자료 리스트');
  const expenseIdx = getColumnIndex('사업비 사용액');
  const bankAmountIdx = getColumnIndex('통장에 찍힌 입/출금액');
  const normalizedRows = renumberRows(nonEmptyRows.map((row, index) => normalizeImportRow(row, index)));
  const withEvidenceMap = normalizedRows.map((row) => {
    if (budgetCodeIdx < 0 || subCodeIdx < 0 || evidenceIdx < 0) return row;
    const budgetCode = row.cells[budgetCodeIdx] || '';
    const subCode = row.cells[subCodeIdx] || '';
    // 1순위: 프로젝트별 evidenceRequiredMap
    const mapped = resolveEvidenceRequiredDesc(options.evidenceRequiredMap, budgetCode, subCode);
    if (mapped) {
      const cells = [...row.cells];
      cells[evidenceIdx] = mapped;
      return { ...row, cells };
    }
    // 2순위: 기본 규칙표 fallback (비목 + 금액 기반)
    const amountStr = (expenseIdx >= 0 ? row.cells[expenseIdx] : '')
      || (bankAmountIdx >= 0 ? row.cells[bankAmountIdx] : '')
      || '';
    const ruleResult = resolveEvidenceRequiredByRules(
      normalizeBudgetLabel(budgetCode),
      normalizeBudgetLabel(subCode),
      amountStr,
    );
    if (!ruleResult) return row;
    const cells = [...row.cells];
    cells[evidenceIdx] = ruleResult;
    return { ...row, cells };
  });

  return deriveSettlementRows(
    withEvidenceMap,
    buildSettlementDerivationContext(options.projectId, options.defaultLedgerId, options.policy, options.basis),
    { mode: 'full' },
  );
}
