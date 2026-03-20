import type { BudgetCodeEntry, BudgetPlanRow, CashflowSheetLineId, ProjectSheetSourceType } from '../data/types';
import { normalizeBankStatementMatrix, type BankStatementSheet } from './bank-statement';
import { normalizeSpace, parseNumber } from './csv-utils';
import { parseCashflowLineLabel } from './settlement-csv';

export type GoogleSheetMigrationTarget =
  | 'expense_sheet'
  | 'budget_plan'
  | 'bank_statement'
  | 'evidence_rules'
  | 'cashflow_projection'
  | 'preview_only';

export interface GoogleSheetMigrationDescriptor {
  target: GoogleSheetMigrationTarget;
  kindLabel: string;
  description: string;
  recommendedScreen: string;
  applySupported: boolean;
  readinessLabel: string;
}

export interface BudgetSheetImportPayload {
  rows: BudgetPlanRow[];
  codeBook: BudgetCodeEntry[];
}

export interface EvidenceRuleImportPayload {
  map: Record<string, string>;
}

export interface CashflowProjectionImportPayload {
  sheets: Array<{
    yearMonth: string;
    weekNo: number;
    amounts: Partial<Record<CashflowSheetLineId, number>>;
  }>;
}

export interface BudgetPlanMergeSummary {
  importedCount: number;
  createCount: number;
  updateCount: number;
  unchangedCount: number;
}

export interface BudgetPlanMergePlan {
  mergedRows: BudgetPlanRow[];
  codeBook: BudgetCodeEntry[];
  importedRows: BudgetPlanRow[];
  importedCodeBook: BudgetCodeEntry[];
  summary: BudgetPlanMergeSummary;
}

export function resolveProjectSheetSourceType(
  target: GoogleSheetMigrationTarget,
): ProjectSheetSourceType | null {
  switch (target) {
    case 'expense_sheet':
      return 'usage';
    case 'budget_plan':
      return 'budget';
    case 'evidence_rules':
      return 'evidence_rules';
    case 'cashflow_projection':
      return 'cashflow';
    case 'bank_statement':
      return 'bank_statement';
    default:
      return null;
  }
}

function normalizeBudgetLabel(value: unknown): string {
  return String(value || '')
    .replace(/^\s*\d+(?:[.\-]\d+)?\s*/, '')
    .replace(/^[.\-]+\s*/, '')
    .trim();
}

function normalizeHeader(value: unknown): string {
  return normalizeSpace(String(value || ''))
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readCell(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return '';
  return normalizeHeader(row[index]);
}

function findHeaderRow(matrix: string[][], predicates: string[], scanLimit = 20): number {
  const max = Math.min(scanLimit, matrix.length);
  for (let rowIndex = 0; rowIndex < max; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const normalized = row.map((cell) => normalizeHeader(cell));
    const matched = predicates.every((needle) => normalized.some((cell) => cell.includes(needle)));
    if (matched) return rowIndex;
  }
  return -1;
}

function findColumnIndex(headers: string[], needle: string): number {
  return headers.findIndex((header) => header.includes(needle));
}

function buildBudgetCodeBook(rows: BudgetPlanRow[]): BudgetCodeEntry[] {
  const orderedCodes: string[] = [];
  const subCodesByCode = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const code = normalizeBudgetLabel(row.budgetCode);
    const sub = normalizeBudgetLabel(row.subCode);
    if (!code || !sub) return;
    if (!subCodesByCode.has(code)) {
      subCodesByCode.set(code, new Set());
      orderedCodes.push(code);
    }
    subCodesByCode.get(code)?.add(sub);
  });
  return orderedCodes.map((code) => ({
    code,
    subCodes: Array.from(subCodesByCode.get(code)?.values() || []),
  }));
}

function readMultilineCell(row: string[] | undefined, index: number): string {
  if (!row || index < 0) return '';
  return String(row[index] || '')
    .split(/\r?\n/g)
    .map((line) => normalizeSpace(line))
    .filter(Boolean)
    .join('\n');
}

function isSubtotalLike(value: string): boolean {
  const normalized = normalizeBudgetLabel(value);
  return normalized.includes('소계') || normalized.includes('총계') || normalized.includes('합계');
}

export function describeGoogleSheetMigrationTarget(sheetName: string): GoogleSheetMigrationDescriptor {
  const normalized = String(sheetName || '').trim();
  const isENaraCashflowGuide = normalized.includes('cashflow') && normalized.includes('이나라도움');
  if (!normalized) {
    return {
      target: 'preview_only',
      kindLabel: '미분류',
      description: '탭을 선택하면 현재 플랫폼에서 연결 가능한 화면과 반영 가능 여부를 안내합니다.',
      recommendedScreen: '사업비 입력(주간)',
      applySupported: false,
      readinessLabel: '탭 선택 필요',
    };
  }
  if (normalized.includes('예산총괄') || normalized.includes('그룹예산')) {
    return {
      target: 'budget_plan',
      kindLabel: '예산',
      description: '비목/세목, 최초 승인 예산, 변경 예산을 가져와 예산 편집에 반영합니다.',
      recommendedScreen: '예산 편집',
      applySupported: true,
      readinessLabel: '안전 반영 가능',
    };
  }
  if (normalized.includes('비목별 증빙자료') || normalized.includes('증빙서류')) {
    return {
      target: 'evidence_rules',
      kindLabel: '증빙 규칙',
      description: '비목/세목별 필수 증빙 규칙을 프로젝트 설정에 seed합니다.',
      recommendedScreen: '사업비 입력(주간)',
      applySupported: true,
      readinessLabel: '안전 반영 가능',
    };
  }
  if (normalized.includes('cashflow') && !normalized.includes('가이드')) {
    return {
      target: 'cashflow_projection',
      kindLabel: '캐시플로우',
      description: '주차별 projection 값을 읽어 캐시플로우 화면에 반영합니다. Actual은 거래에서 재계산됩니다.',
      recommendedScreen: '캐시플로우',
      applySupported: true,
      readinessLabel: 'projection 반영 가능',
    };
  }
  if (isENaraCashflowGuide || normalized.includes('cashflow')) {
    return {
      target: 'cashflow_projection',
      kindLabel: '캐시플로우',
      description: isENaraCashflowGuide
        ? 'e나라도움 전용 cashflow 탭입니다. 주차 헤더가 감지되면 projection으로 반영하고, 그렇지 않으면 원본 preview로 확인합니다.'
        : '구조가 유사한 cashflow 탭입니다. 주차 헤더가 감지되면 projection으로 반영합니다.',
      recommendedScreen: '캐시플로우',
      applySupported: true,
      readinessLabel: isENaraCashflowGuide ? 'e나라도움 cashflow 후보' : '주차 헤더 기반 반영',
    };
  }
  if (normalized.includes('인력투입률')) {
    return {
      target: 'preview_only',
      kindLabel: '참여율',
      description: '참여율/투입률 migration은 별도 단계에서 처리하는 것이 안전합니다.',
      recommendedScreen: '참여율/인력구성',
      applySupported: false,
      readinessLabel: '후속 migration 대상',
    };
  }
  if (normalized.includes('사용내역') || normalized.includes('지출대장') || normalized.includes('비용사용내역')) {
    return {
      target: 'expense_sheet',
      kindLabel: '사업비 입력',
      description: '기존 정산 시트 컬럼과 직접 매핑됩니다.',
      recommendedScreen: '사업비 입력(주간)',
      applySupported: true,
      readinessLabel: '즉시 반영 가능',
    };
  }
  if (normalized.includes('통장내역')) {
    return {
      target: 'bank_statement',
      kindLabel: '통장 원본',
      description: '통장내역 전용 parser로 읽어 통장내역 화면과 주간 사업비 초안에 연결합니다.',
      recommendedScreen: '통장내역',
      applySupported: true,
      readinessLabel: '안전 반영 가능',
    };
  }
  return {
    target: 'preview_only',
    kindLabel: '참고/기타',
    description: '현재 wizard에서는 구조 점검만 지원합니다. 실제 반영은 별도 전용 흐름이 필요합니다.',
    recommendedScreen: '별도 확인',
    applySupported: false,
    readinessLabel: 'preview only',
  };
}

export function parseBudgetPlanMatrix(matrix: string[][]): BudgetSheetImportPayload {
  const headerRowIndex = findHeaderRow(matrix, ['비목', '세목', '최초 승인 예산'], 20);
  if (headerRowIndex < 0) {
    return { rows: [], codeBook: [] };
  }
  const headers = (matrix[headerRowIndex] || []).map((cell) => normalizeHeader(cell));
  const budgetCodeIndex = findColumnIndex(headers, '비목');
  const subCodeIndex = findColumnIndex(headers, '세목');
  const calcDescIndex = findColumnIndex(headers, '산정 내역');
  const initialBudgetIndex = findColumnIndex(headers, '최초 승인 예산');
  const revisedBudgetIndex = findColumnIndex(headers, '변경 승인 예산') >= 0
    ? findColumnIndex(headers, '변경 승인 예산')
    : findColumnIndex(headers, '변경 예산');
  const noteIndex = findColumnIndex(headers, '특이사항');
  if (budgetCodeIndex < 0 || subCodeIndex < 0 || initialBudgetIndex < 0) {
    return { rows: [], codeBook: [] };
  }

  const rows: BudgetPlanRow[] = [];
  let currentBudgetCode = '';
  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const budgetCodeRaw = readCell(row, budgetCodeIndex);
    const subCodeRaw = readCell(row, subCodeIndex);
    const calcDescRaw = readCell(row, calcDescIndex);
    const noteRaw = readCell(row, noteIndex);

    if (budgetCodeRaw) {
      currentBudgetCode = budgetCodeRaw;
    }
    const budgetCode = normalizeBudgetLabel(budgetCodeRaw || currentBudgetCode);
    const subCode = normalizeBudgetLabel(subCodeRaw);
    if (!budgetCode && !subCode && !calcDescRaw && !noteRaw) continue;
    if (!budgetCode || !subCode) continue;
    if (isSubtotalLike(budgetCode) || isSubtotalLike(subCode)) continue;

    const initialBudget = parseNumber(readCell(row, initialBudgetIndex)) ?? 0;
    const revisedBudget = revisedBudgetIndex >= 0 ? (parseNumber(readCell(row, revisedBudgetIndex)) ?? 0) : 0;
    const note = [calcDescRaw, noteRaw].filter(Boolean).join(' | ').trim();
    rows.push({
      budgetCode,
      subCode,
      initialBudget,
      ...(revisedBudget !== 0 ? { revisedBudget } : {}),
      ...(note ? { note } : {}),
    });
  }

  return {
    rows,
    codeBook: buildBudgetCodeBook(rows),
  };
}

function buildBudgetPlanMatchKey(row: BudgetPlanRow): string {
  return `${normalizeBudgetLabel(row.budgetCode)}|${normalizeBudgetLabel(row.subCode)}`;
}

export function planBudgetPlanMerge(
  existingRows: BudgetPlanRow[],
  importedRows: BudgetPlanRow[],
): BudgetPlanMergePlan {
  const mergedRows = existingRows.map((row) => ({ ...row }));
  const existingIndexByKey = new Map<string, number>();
  mergedRows.forEach((row, index) => {
    existingIndexByKey.set(buildBudgetPlanMatchKey(row), index);
  });

  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;

  importedRows.forEach((row) => {
    const key = buildBudgetPlanMatchKey(row);
    if (!key || key === '|') return;
    const existingIndex = existingIndexByKey.get(key);
    if (existingIndex == null) {
      mergedRows.push({ ...row });
      existingIndexByKey.set(key, mergedRows.length - 1);
      createCount += 1;
      return;
    }

    const existing = mergedRows[existingIndex];
    const next: BudgetPlanRow = {
      ...existing,
      ...row,
      budgetCode: row.budgetCode || existing.budgetCode,
      subCode: row.subCode || existing.subCode,
      initialBudget: Number.isFinite(row.initialBudget) ? row.initialBudget : existing.initialBudget,
      ...(Number.isFinite(row.revisedBudget ?? NaN)
        ? { revisedBudget: row.revisedBudget }
        : (Number.isFinite(existing.revisedBudget ?? NaN) ? { revisedBudget: existing.revisedBudget } : {})),
      ...((row.note ?? '').trim()
        ? { note: row.note?.trim() }
        : ((existing.note ?? '').trim() ? { note: existing.note?.trim() } : {})),
    };
    const changed = JSON.stringify(existing) !== JSON.stringify(next);
    mergedRows[existingIndex] = next;
    if (changed) {
      updateCount += 1;
    } else {
      unchangedCount += 1;
    }
  });

  return {
    mergedRows,
    codeBook: buildBudgetCodeBook(mergedRows),
    importedRows: importedRows.map((row) => ({ ...row })),
    importedCodeBook: buildBudgetCodeBook(importedRows),
    summary: {
      importedCount: importedRows.length,
      createCount,
      updateCount,
      unchangedCount,
    },
  };
}

export function parseEvidenceRuleMatrix(matrix: string[][]): EvidenceRuleImportPayload {
  const headerRowIndex = (() => {
    const preferred = findHeaderRow(matrix, ['비목', '세목', '사전 업로드', '사후 업로드'], 40);
    if (preferred >= 0) return preferred;
    return findHeaderRow(matrix, ['비목', '세목', '필수 증빙 자료'], 40);
  })();
  if (headerRowIndex < 0) {
    return { map: {} };
  }
  const headers = (matrix[headerRowIndex] || []).map((cell) => normalizeHeader(cell));
  const budgetIndex = findColumnIndex(headers, '비목');
  const explicitSubCodeIndex = findColumnIndex(headers, '세목');
  const preIndex = findColumnIndex(headers, '사전 업로드');
  const postIndex = findColumnIndex(headers, '사후 업로드');
  const requiredIndex = findColumnIndex(headers, '필수 증빙 자료');
  const extraIndex = findColumnIndex(headers, '회계법인 추가 요청했던 자료');
  const firstDocIndex = [preIndex, postIndex, requiredIndex, extraIndex]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0] ?? -1;
  if (budgetIndex < 0 || firstDocIndex < 0) {
    return { map: {} };
  }

  const map: Record<string, string> = {};
  let currentBudgetCode = '';

  for (let rowIndex = headerRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const budgetRaw = readCell(row, budgetIndex);
    if (budgetRaw) {
      currentBudgetCode = budgetRaw;
    }
    const budgetCode = normalizeBudgetLabel(budgetRaw || currentBudgetCode);
    const subCode = explicitSubCodeIndex >= 0
      ? normalizeBudgetLabel(readCell(row, explicitSubCodeIndex))
      : (() => {
        const subCandidates = row
          .slice(budgetIndex + 1, firstDocIndex)
          .map((cell) => normalizeBudgetLabel(cell))
          .filter(Boolean);
        return subCandidates[subCandidates.length - 1] || '';
      })();
    const docs = [
      preIndex >= 0 ? readMultilineCell(row, preIndex) : '',
      postIndex >= 0 ? readMultilineCell(row, postIndex) : '',
      requiredIndex >= 0 ? readMultilineCell(row, requiredIndex) : '',
      extraIndex >= 0 ? readMultilineCell(row, extraIndex) : '',
    ]
      .flatMap((value) => value.split(/\r?\n/g))
      .map((value) => normalizeSpace(value))
      .filter(Boolean);
    const combinedDocs = Array.from(new Set(docs)).join('\n').trim();

    if (!budgetCode || !subCode || !combinedDocs) continue;
    map[`${budgetCode}|${subCode}`] = combinedDocs;
  }

  return { map };
}

function parseWeekCode(value: string): { yearMonth: string; weekNo: number } | null {
  const match = String(value || '').trim().match(/^(\d{2})-(\d{1,2})-(\d)$/);
  if (!match) return null;
  const year = `20${match[1]}`;
  const month = match[2].padStart(2, '0');
  const weekNo = Number.parseInt(match[3], 10);
  if (!Number.isFinite(weekNo)) return null;
  return {
    yearMonth: `${year}-${month}`,
    weekNo,
  };
}

export function parseCashflowProjectionMatrix(matrix: string[][]): CashflowProjectionImportPayload {
  const weekHeaderRowIndex = matrix.findIndex((row) => (row || []).some((cell) => parseWeekCode(String(cell || ''))));
  if (weekHeaderRowIndex < 0) {
    return { sheets: [] };
  }

  const weekColumns = (matrix[weekHeaderRowIndex] || [])
    .map((cell, columnIndex) => ({ parsed: parseWeekCode(String(cell || '')), columnIndex }))
    .filter((entry): entry is { parsed: { yearMonth: string; weekNo: number }; columnIndex: number } => Boolean(entry.parsed));

  if (weekColumns.length === 0) {
    return { sheets: [] };
  }

  const byDocId = new Map<string, { yearMonth: string; weekNo: number; amounts: Partial<Record<CashflowSheetLineId, number>> }>();
  for (let rowIndex = weekHeaderRowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const lineLabel = normalizeHeader(row[0]);
    const lineId = parseCashflowLineLabel(lineLabel);
    if (!lineId) continue;

    weekColumns.forEach(({ parsed, columnIndex }) => {
      const amount = parseNumber(normalizeHeader(row[columnIndex]));
      if (amount == null) return;
      const docId = `${parsed.yearMonth}-w${parsed.weekNo}`;
      if (!byDocId.has(docId)) {
        byDocId.set(docId, {
          yearMonth: parsed.yearMonth,
          weekNo: parsed.weekNo,
          amounts: {},
        });
      }
      byDocId.get(docId)!.amounts[lineId] = amount;
    });
  }

  return {
    sheets: Array.from(byDocId.values()).filter((entry) => Object.keys(entry.amounts).length > 0),
  };
}

export function parseBankStatementMatrix(matrix: string[][]): BankStatementSheet {
  return normalizeBankStatementMatrix(matrix);
}
