import type { BudgetCodeEntry, BudgetPlanRow, CashflowSheetLineId, ProjectSheetSourceType } from '../data/types';
import { normalizeBankStatementMatrix, type BankStatementSheet } from './bank-statement';
import { buildBudgetLabelKey, normalizeBudgetLabel } from './budget-labels';
import { normalizeKey, normalizeSpace, parseNumber } from './csv-utils';
import { parseCashflowLineLabel } from './settlement-csv';

export type GoogleSheetMigrationTarget =
  | 'expense_sheet'
  | 'budget_plan'
  | 'bank_statement'
  | 'evidence_rules'
  | 'cashflow_projection'
  | 'cashflow_guide'
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
  warnings?: string[];
  confidence?: 'high' | 'medium' | 'low';
  formatGuideRecommended?: boolean;
  headerRowIndex?: number;
  headerRowCount?: number;
  detectedColumns?: Partial<Record<'category' | 'budgetCode' | 'subCode' | 'calcDesc' | 'initialBudget' | 'revisedBudget' | 'note', number>>;
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
    case 'cashflow_guide':
      return 'cashflow';
    case 'bank_statement':
      return 'bank_statement';
    default:
      return null;
  }
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

type BudgetPlanFieldKey =
  | 'category'
  | 'budgetCode'
  | 'subCode'
  | 'calcDesc'
  | 'initialBudget'
  | 'revisedBudget'
  | 'note';

interface BudgetPlanFieldMatch {
  index: number;
  source: 'header' | 'inferred';
}

interface BudgetPlanHeaderCandidate {
  rowIndex: number;
  headerRowCount: number;
  headers: string[];
  matches: Partial<Record<BudgetPlanFieldKey, BudgetPlanFieldMatch>>;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

const BUDGET_PLAN_FIELD_ALIASES: Record<BudgetPlanFieldKey, string[]> = {
  category: ['사업비 구분', '구분', '대분류', '영역'],
  budgetCode: ['비목', '비목명', 'budgetcategory', 'budgetcode', 'category'],
  subCode: ['세목', '세목명', '세부 비목', 'budgetsubcategory', 'subcategory', 'detailcategory'],
  calcDesc: ['산정 내역', '산정내역', '산출 내역', '산출내역', '세세목', '상세 내역', '상세내역'],
  initialBudget: ['최초 승인 예산', '최초승인예산', '당초예산', '당초 예산', '초기예산', '초기 예산', '승인 예산', '최초 예산', '예산액'],
  revisedBudget: ['변경 승인 예산', '변경승인예산', '변경 예산', '수정 예산', '조정 예산', '최종 예산', '변경후 예산', '변경후예산'],
  note: ['특이사항', '비고', '메모', '참고', 'note'],
};

function normalizeBudgetHeaderKey(value: unknown): string {
  return normalizeKey(normalizeHeader(String(value || '')).replace(/[<>]/g, ' '));
}

function synthesizeBudgetHeaders(headerRows: string[][]): string[] {
  const colCount = Math.max(...headerRows.map((row) => row.length), 0);
  const headers: string[] = [];
  for (let colIdx = 0; colIdx < colCount; colIdx += 1) {
    const parts: string[] = [];
    headerRows.forEach((row) => {
      const cleaned = normalizeHeader(String(row[colIdx] || ''));
      if (cleaned && !parts.includes(cleaned)) parts.push(cleaned);
    });
    headers.push(parts.join(' > ') || `col_${colIdx + 1}`);
  }
  return headers;
}

function scoreBudgetHeaderAliasMatch(header: string, aliases: string[]): number {
  const key = normalizeBudgetHeaderKey(header);
  if (!key) return -1;
  let bestScore = -1;
  aliases.forEach((alias) => {
    const aliasKey = normalizeBudgetHeaderKey(alias);
    if (!aliasKey) return;
    if (key === aliasKey) {
      bestScore = Math.max(bestScore, 100 + aliasKey.length);
      return;
    }
    if (key.includes(aliasKey)) {
      bestScore = Math.max(bestScore, 70 + aliasKey.length);
      return;
    }
    if (aliasKey.includes(key)) {
      bestScore = Math.max(bestScore, 40 + key.length);
    }
  });
  return bestScore;
}

function looksLikeNumberCell(raw: string): boolean {
  const value = normalizeHeader(raw);
  if (!value) return false;
  if (parseNumber(value) == null) return false;
  return /[0-9]/.test(value);
}

function buildBudgetColumnStats(rows: string[][], columnCount: number): Array<{
  nonEmptyCount: number;
  numericCount: number;
  textCount: number;
  distinctTextCount: number;
}> {
  return Array.from({ length: columnCount }, (_, colIdx) => {
    const values = rows
      .map((row) => normalizeHeader(String(row[colIdx] || '')))
      .filter(Boolean);
    const numericValues = values.filter((value) => looksLikeNumberCell(value));
    const textValues = values.filter((value) => !looksLikeNumberCell(value) && !isSubtotalLike(value));
    return {
      nonEmptyCount: values.length,
      numericCount: numericValues.length,
      textCount: textValues.length,
      distinctTextCount: new Set(textValues.map((value) => normalizeBudgetLabel(value) || value)).size,
    };
  });
}

function detectBudgetPlanFieldMatches(
  headers: string[],
  sampleRows: string[][],
): Partial<Record<BudgetPlanFieldKey, BudgetPlanFieldMatch>> {
  const matches: Partial<Record<BudgetPlanFieldKey, BudgetPlanFieldMatch>> = {};
  const usedIndexes = new Set<number>();

  const claimHeaderMatch = (field: BudgetPlanFieldKey) => {
    const index = headers
      .map((header, headerIdx) => ({
        headerIdx,
        score: usedIndexes.has(headerIdx) ? -1 : scoreBudgetHeaderAliasMatch(header, BUDGET_PLAN_FIELD_ALIASES[field]),
      }))
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score || left.headerIdx - right.headerIdx)[0]?.headerIdx;
    if (index != null) {
      matches[field] = { index, source: 'header' };
      usedIndexes.add(index);
    }
  };

  (['category', 'budgetCode', 'subCode', 'calcDesc', 'initialBudget', 'revisedBudget', 'note'] as BudgetPlanFieldKey[])
    .forEach(claimHeaderMatch);

  const stats = buildBudgetColumnStats(sampleRows, headers.length);
  const firstAmountIndex = Math.min(
    matches.initialBudget?.index ?? Number.POSITIVE_INFINITY,
    matches.revisedBudget?.index ?? Number.POSITIVE_INFINITY,
  );

  if (!matches.initialBudget) {
    const index = stats
      .map((stat, statIdx) => ({ stat, statIdx }))
      .filter(({ statIdx, stat }) => !usedIndexes.has(statIdx) && stat.nonEmptyCount > 0 && stat.numericCount / stat.nonEmptyCount >= 0.6)
      .sort((left, right) => (right.stat.numericCount - left.stat.numericCount) || (left.statIdx - right.statIdx))[0]?.statIdx;
    if (index != null) {
      matches.initialBudget = { index, source: 'inferred' };
      usedIndexes.add(index);
    }
  }

  if (!matches.revisedBudget) {
    const index = stats
      .map((stat, statIdx) => ({ stat, statIdx }))
      .filter(({ statIdx, stat }) => !usedIndexes.has(statIdx) && stat.nonEmptyCount > 0 && stat.numericCount / stat.nonEmptyCount >= 0.5)
      .sort((left, right) => (left.statIdx - right.statIdx) || (right.stat.numericCount - left.stat.numericCount))[0]?.statIdx;
    if (index != null) {
      matches.revisedBudget = { index, source: 'inferred' };
      usedIndexes.add(index);
    }
  }

  const textCandidates = stats
    .map((stat, statIdx) => ({ stat, statIdx }))
    .filter(({ statIdx, stat }) => {
      if (usedIndexes.has(statIdx)) return false;
      if (stat.nonEmptyCount === 0 || stat.textCount === 0) return false;
      if (Number.isFinite(firstAmountIndex) && statIdx > firstAmountIndex + 1) return false;
      return stat.textCount / stat.nonEmptyCount >= 0.5;
    })
    .sort((left, right) => {
      if (left.statIdx !== right.statIdx) return left.statIdx - right.statIdx;
      return right.stat.distinctTextCount - left.stat.distinctTextCount;
    });

  if (!matches.budgetCode && textCandidates[0]) {
    matches.budgetCode = { index: textCandidates[0].statIdx, source: 'inferred' };
    usedIndexes.add(textCandidates[0].statIdx);
  }

  if (!matches.subCode) {
    const nextSubCandidate = textCandidates.find(({ statIdx }) => !usedIndexes.has(statIdx));
    if (nextSubCandidate) {
      matches.subCode = { index: nextSubCandidate.statIdx, source: 'inferred' };
      usedIndexes.add(nextSubCandidate.statIdx);
    }
  }

  if (!matches.note) {
    const index = stats
      .map((stat, statIdx) => ({ stat, statIdx }))
      .filter(({ statIdx, stat }) => !usedIndexes.has(statIdx) && stat.textCount > 0 && stat.distinctTextCount > 1)
      .sort((left, right) => {
        const leftAfterAmount = left.statIdx > firstAmountIndex ? 1 : 0;
        const rightAfterAmount = right.statIdx > firstAmountIndex ? 1 : 0;
        if (leftAfterAmount !== rightAfterAmount) return rightAfterAmount - leftAfterAmount;
        return right.stat.distinctTextCount - left.stat.distinctTextCount;
      })[0]?.statIdx;
    if (index != null) {
      matches.note = { index, source: 'inferred' };
      usedIndexes.add(index);
    }
  }

  return matches;
}

function scoreBudgetPlanHeaderCandidate(
  matrix: string[][],
  rowIndex: number,
  headerRowCount: number,
): BudgetPlanHeaderCandidate {
  const headerRows = matrix.slice(rowIndex, rowIndex + headerRowCount)
    .map((row) => (row || []).map((cell) => normalizeHeader(String(cell || ''))));
  const headers = synthesizeBudgetHeaders(headerRows);
  const sampleRows = matrix
    .slice(rowIndex + headerRowCount, rowIndex + headerRowCount + 12)
    .map((row) => headers.map((_, colIdx) => normalizeHeader(String((row || [])[colIdx] || ''))))
    .filter((row) => row.some(Boolean));
  const matches = detectBudgetPlanFieldMatches(headers, sampleRows);

  let score = 0;
  const warnings: string[] = [];
  const requiredFields: BudgetPlanFieldKey[] = ['budgetCode', 'subCode', 'initialBudget'];
  requiredFields.forEach((field) => {
    const match = matches[field];
    if (!match) return;
    score += match.source === 'header' ? 35 : 18;
  });
  (['revisedBudget', 'calcDesc', 'note', 'category'] as BudgetPlanFieldKey[]).forEach((field) => {
    const match = matches[field];
    if (!match) return;
    score += match.source === 'header' ? 12 : 6;
  });

  if (!matches.budgetCode || !matches.subCode || !matches.initialBudget) {
    score -= 50;
  }

  const amountIndex = matches.initialBudget?.index ?? -1;
  const subCodeIndex = matches.subCode?.index ?? -1;
  const plausibleDataRows = sampleRows.filter((row) => {
    const subCodeValue = subCodeIndex >= 0 ? normalizeBudgetLabel(row[subCodeIndex] || '') : '';
    const initialAmount = amountIndex >= 0 ? parseNumber(row[amountIndex] || '') : null;
    return Boolean(subCodeValue) && initialAmount != null;
  }).length;
  score += plausibleDataRows * 4;

  const inferredFields = Object.entries(matches)
    .filter(([, match]) => match?.source === 'inferred')
    .map(([field]) => field);
  if (inferredFields.length > 0) {
    warnings.push(`일부 열(${inferredFields.join(', ')})은 서식 패턴으로 추정했습니다.`);
  }
  if (plausibleDataRows === 0) {
    warnings.push('헤더는 찾았지만 바로 아래 데이터 행에서 예산 패턴이 약합니다.');
  }

  const headerMatchedRequiredCount = requiredFields.filter((field) => matches[field]?.source === 'header').length;
  const confidence: 'high' | 'medium' | 'low' = (
    headerMatchedRequiredCount === requiredFields.length && plausibleDataRows >= 2
  )
    ? 'high'
    : (headerMatchedRequiredCount >= 2 && requiredFields.every((field) => matches[field]) && plausibleDataRows >= 1 ? 'medium' : 'low');

  return {
    rowIndex,
    headerRowCount,
    headers,
    matches,
    score,
    confidence,
    warnings,
  };
}

function detectBudgetPlanHeader(matrix: string[][]): BudgetPlanHeaderCandidate | null {
  const scanLimit = Math.min(matrix.length, 25);
  let best: BudgetPlanHeaderCandidate | null = null;
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    for (let headerRowCount = 1; headerRowCount <= 3 && rowIndex + headerRowCount <= scanLimit; headerRowCount += 1) {
      const candidate = scoreBudgetPlanHeaderCandidate(matrix, rowIndex, headerRowCount);
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }
  if (!best || best.score < 40) return null;
  return best;
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
      target: 'cashflow_guide',
      kindLabel: '캐시플로우 가이드',
      description: isENaraCashflowGuide
        ? 'e나라도움 전용 guide 탭입니다. 자동 반영 대신 원본 preview와 비교 참고용으로 사용합니다.'
        : '구조가 유사한 cashflow guide 탭입니다. 자동 반영 대신 비교/참고용으로 사용합니다.',
      recommendedScreen: '캐시플로우',
      applySupported: false,
      readinessLabel: isENaraCashflowGuide ? '가이드 preview 권장' : '비교/안내 전용',
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
  const header = detectBudgetPlanHeader(matrix);
  if (!header) {
    return {
      rows: [],
      codeBook: [],
      warnings: ['표준 예산총괄 헤더를 찾지 못했습니다. 권장 헤더 이름과 열 순서로 정리한 뒤 다시 가져와 주세요.'],
      confidence: 'low',
      formatGuideRecommended: true,
    };
  }
  const budgetCodeIndex = header.matches.budgetCode?.index ?? -1;
  const subCodeIndex = header.matches.subCode?.index ?? -1;
  const calcDescIndex = header.matches.calcDesc?.index ?? -1;
  const initialBudgetIndex = header.matches.initialBudget?.index ?? -1;
  const revisedBudgetIndex = header.matches.revisedBudget?.index ?? -1;
  const noteIndex = header.matches.note?.index ?? -1;
  if (budgetCodeIndex < 0 || subCodeIndex < 0 || initialBudgetIndex < 0) {
    return {
      rows: [],
      codeBook: [],
      warnings: [
        ...header.warnings,
        '비목/세목/예산 열을 확정하지 못했습니다. 헤더 이름과 행 구성을 맞춘 뒤 다시 가져와 주세요.',
      ],
      confidence: 'low',
      formatGuideRecommended: true,
      headerRowIndex: header.rowIndex,
      headerRowCount: header.headerRowCount,
      detectedColumns: Object.fromEntries(
        Object.entries(header.matches).map(([field, match]) => [field, match?.index ?? -1]),
      ) as BudgetSheetImportPayload['detectedColumns'],
    };
  }

  const rows: BudgetPlanRow[] = [];
  let currentBudgetCode = '';
  for (let rowIndex = header.rowIndex + header.headerRowCount; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const budgetCodeRaw = readCell(row, budgetCodeIndex);
    const subCodeRaw = readCell(row, subCodeIndex);
    const calcDescRaw = readCell(row, calcDescIndex);
    const noteRaw = readCell(row, noteIndex);
    const initialBudgetRaw = readCell(row, initialBudgetIndex);
    const revisedBudgetRaw = revisedBudgetIndex >= 0 ? readCell(row, revisedBudgetIndex) : '';

    const rowText = row.map((cell) => normalizeHeader(String(cell || ''))).filter(Boolean);
    if (rowText.length === 0) continue;

    if (budgetCodeRaw) {
      currentBudgetCode = budgetCodeRaw;
    }
    const budgetCode = normalizeBudgetLabel(budgetCodeRaw || currentBudgetCode);
    const subCode = normalizeBudgetLabel(subCodeRaw);
    const initialBudget = parseNumber(initialBudgetRaw) ?? 0;
    const revisedBudget = revisedBudgetRaw ? (parseNumber(revisedBudgetRaw) ?? 0) : 0;

    const hasAnyAmount = initialBudgetRaw !== '' || revisedBudgetRaw !== '';
    const looksLikeSectionRow = Boolean(budgetCodeRaw) && !subCodeRaw && !hasAnyAmount && !calcDescRaw && !noteRaw;
    if (looksLikeSectionRow) continue;
    if (!budgetCode && !subCode && !calcDescRaw && !noteRaw && !hasAnyAmount) continue;
    if (!budgetCode || !subCode) continue;
    if (isSubtotalLike(budgetCode) || isSubtotalLike(subCode)) continue;
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
    warnings: header.warnings,
    confidence: header.confidence,
    formatGuideRecommended: header.confidence === 'low',
    headerRowIndex: header.rowIndex,
    headerRowCount: header.headerRowCount,
    detectedColumns: Object.fromEntries(
      Object.entries(header.matches).map(([field, match]) => [field, match?.index ?? -1]),
    ) as BudgetSheetImportPayload['detectedColumns'],
  };
}

function buildBudgetPlanMatchKey(row: BudgetPlanRow): string {
  return buildBudgetLabelKey(row.budgetCode, row.subCode);
}

export function planBudgetPlanMerge(
  existingRows: BudgetPlanRow[],
  importedRows: BudgetPlanRow[],
): BudgetPlanMergePlan {
  const mergedRows = existingRows.map((row) => ({
    ...row,
    budgetCode: normalizeBudgetLabel(row.budgetCode),
    subCode: normalizeBudgetLabel(row.subCode),
  }));
  const existingIndexByKey = new Map<string, number>();
  mergedRows.forEach((row, index) => {
    existingIndexByKey.set(buildBudgetPlanMatchKey(row), index);
  });

  let createCount = 0;
  let updateCount = 0;
  let unchangedCount = 0;

  importedRows.forEach((row) => {
    const normalizedRow: BudgetPlanRow = {
      ...row,
      budgetCode: normalizeBudgetLabel(row.budgetCode),
      subCode: normalizeBudgetLabel(row.subCode),
    };
    const key = buildBudgetPlanMatchKey(normalizedRow);
    if (!key || key === '|') return;
    const existingIndex = existingIndexByKey.get(key);
    if (existingIndex == null) {
      mergedRows.push(normalizedRow);
      existingIndexByKey.set(key, mergedRows.length - 1);
      createCount += 1;
      return;
    }

    const existing = mergedRows[existingIndex];
    const next: BudgetPlanRow = {
      ...existing,
      ...normalizedRow,
      budgetCode: normalizedRow.budgetCode || existing.budgetCode,
      subCode: normalizedRow.subCode || existing.subCode,
      initialBudget: Number.isFinite(normalizedRow.initialBudget) ? normalizedRow.initialBudget : existing.initialBudget,
      ...(Number.isFinite(normalizedRow.revisedBudget ?? NaN)
        ? { revisedBudget: normalizedRow.revisedBudget }
        : (Number.isFinite(existing.revisedBudget ?? NaN) ? { revisedBudget: existing.revisedBudget } : {})),
      ...((normalizedRow.note ?? '').trim()
        ? { note: normalizedRow.note?.trim() }
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
    importedRows: importedRows.map((row) => ({
      ...row,
      budgetCode: normalizeBudgetLabel(row.budgetCode),
      subCode: normalizeBudgetLabel(row.subCode),
    })),
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
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const patterns = [
    /^(\d{2})[-./](\d{1,2})[-./](\d)\s*주?$/i,
    /^(\d{4})[-./](\d{1,2})[-./](\d)\s*주?$/i,
    /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d)\s*주$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const rawYear = match[1] || '';
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const month = String(match[2] || '').padStart(2, '0');
    const weekNo = Number.parseInt(String(match[3] || ''), 10);
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !Number.isFinite(weekNo)) continue;
    return {
      yearMonth: `${year}-${month}`,
      weekNo,
    };
  }

  return null;
}

function findCashflowLineId(row: string[]): CashflowSheetLineId | undefined {
  const scanLimit = Math.min(Math.max(row.length, 1), 3);
  for (let columnIndex = 0; columnIndex < scanLimit; columnIndex += 1) {
    const lineId = parseCashflowLineLabel(normalizeHeader(row[columnIndex]));
    if (lineId) return lineId;
  }
  return undefined;
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
    const lineId = findCashflowLineId(row);
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
