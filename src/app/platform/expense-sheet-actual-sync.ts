import type { ImportRow } from './settlement-csv';

export interface ExpenseSheetRowsSource {
  id: string;
  rows: ImportRow[] | null;
}

export function buildProjectExpenseRowsForActualSync(params: {
  sheets: ExpenseSheetRowsSource[];
  activeSheetId: string;
  activeRows: ImportRow[] | null | undefined;
}): ImportRow[] {
  const activeSheetId = String(params.activeSheetId || 'default').trim() || 'default';
  const activeRows = Array.isArray(params.activeRows) ? params.activeRows : [];
  const sheets = Array.isArray(params.sheets) ? params.sheets : [];
  const rows: ImportRow[] = [];
  let activeSheetFound = false;

  for (const sheet of sheets) {
    const sheetId = String(sheet?.id || '').trim();
    if (!sheetId) continue;
    if (sheetId === activeSheetId) {
      rows.push(...activeRows);
      activeSheetFound = true;
      continue;
    }
    if (Array.isArray(sheet.rows)) rows.push(...sheet.rows);
  }

  if (!activeSheetFound) {
    rows.push(...activeRows);
  }

  return rows;
}
