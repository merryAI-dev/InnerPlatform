import type { BudgetCodeEntry } from '../data/types';
import { normalizeBudgetLabel } from './budget-labels';
import { parseCsv } from './csv-utils';
import { parseBudgetPlanMatrix } from './google-sheet-migration';
import type { LocalWorkbookSheet } from './local-workbook';

export function parseBudgetPlanImportText(text: string): string[][] {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.includes('\t')) {
    return normalized
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.split('\t').map((cell) => String(cell ?? '')));
  }
  return parseCsv(normalized).map((row) => row.map((cell) => String(cell ?? '')));
}

function scoreBudgetPlanSheet(sheet: LocalWorkbookSheet): number {
  const name = String(sheet.name || '').toLowerCase();
  const parsed = parseBudgetPlanMatrix(sheet.matrix);
  let score = parsed.rows.length * 10;
  if (name.includes('예산총괄')) score += 1000;
  else if (name.includes('그룹예산')) score += 900;
  else if (name.includes('예산')) score += 500;
  else if (name.includes('budget')) score += 300;
  return score;
}

export function selectBudgetPlanImportSheet(sheets: LocalWorkbookSheet[]): LocalWorkbookSheet | null {
  if (!Array.isArray(sheets) || sheets.length === 0) return null;
  return [...sheets].sort((left, right) => {
    const scoreDiff = scoreBudgetPlanSheet(right) - scoreBudgetPlanSheet(left);
    if (scoreDiff !== 0) return scoreDiff;
    return (right.matrix?.length || 0) - (left.matrix?.length || 0);
  })[0] || sheets[0];
}

export function mergeBudgetCodeBooks(
  existing: BudgetCodeEntry[],
  imported: BudgetCodeEntry[],
): BudgetCodeEntry[] {
  const merged: BudgetCodeEntry[] = [];
  const indexByCode = new Map<string, number>();

  const appendEntries = (items: BudgetCodeEntry[]) => {
    (items || []).forEach((item) => {
      const rawCode = String(item.code || '').trim();
      const codeKey = normalizeBudgetLabel(rawCode);
      if (!rawCode || !codeKey) return;

      let targetIndex = indexByCode.get(codeKey);
      if (targetIndex == null) {
        targetIndex = merged.length;
        merged.push({ code: rawCode, subCodes: [] });
        indexByCode.set(codeKey, targetIndex);
      }

      const target = merged[targetIndex];
      const seenSubCodes = new Set(target.subCodes.map((value) => normalizeBudgetLabel(value)).filter(Boolean));
      (item.subCodes || []).forEach((subCode) => {
        const rawSubCode = String(subCode || '').trim();
        const subCodeKey = normalizeBudgetLabel(rawSubCode);
        if (!rawSubCode || !subCodeKey || seenSubCodes.has(subCodeKey)) return;
        target.subCodes.push(rawSubCode);
        seenSubCodes.add(subCodeKey);
      });
    });
  };

  appendEntries(existing);
  appendEntries(imported);

  return merged.filter((entry) => entry.subCodes.length > 0);
}
