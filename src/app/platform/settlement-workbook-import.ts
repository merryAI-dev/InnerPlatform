import type { LocalWorkbookSheet } from './local-workbook';
import { analyzeSettlementHeaderMapping, normalizeMatrixToImportRows, type ImportRow } from './settlement-csv';

function scoreSettlementSheet(sheet: LocalWorkbookSheet): number {
  const analysis = analyzeSettlementHeaderMapping(sheet.matrix || []);
  const name = String(sheet.name || '');
  const preferredNameBonus = /정산|사업비|settlement/i.test(name) ? 25 : 0;
  return (
    (analysis.matchedCriticalFields.length * 100)
    + (analysis.matchedHeaders.length * 10)
    - (analysis.unmatchedCriticalFields.length * 30)
    + preferredNameBonus
  );
}

export function pickSettlementWorkbookSheet(
  sheets: LocalWorkbookSheet[],
): LocalWorkbookSheet | null {
  if (!Array.isArray(sheets) || sheets.length === 0) return null;
  const ranked = sheets
    .map((sheet) => ({ sheet, score: scoreSettlementSheet(sheet) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score <= 0) return null;
  return best.sheet;
}

export function normalizeSettlementWorkbookToImportRows(
  sheets: LocalWorkbookSheet[],
): { sheetName: string; rows: ImportRow[] } | null {
  const selectedSheet = pickSettlementWorkbookSheet(sheets);
  if (!selectedSheet) return null;
  const rows = normalizeMatrixToImportRows(selectedSheet.matrix || []);
  if (rows.length === 0) return null;
  return {
    sheetName: selectedSheet.name,
    rows,
  };
}
