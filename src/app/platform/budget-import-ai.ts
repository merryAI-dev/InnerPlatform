export type BudgetImportSourceMode = 'file' | 'paste';

export interface BudgetImportAiDecisionInput {
  open: boolean;
  platformApiEnabled: boolean;
  tenantId?: string | null;
  projectId?: string | null;
  matrix: string[][];
  importedRowCount: number;
  confidence?: 'high' | 'medium' | 'low';
  warningCount?: number;
  formatGuideRecommended?: boolean;
}

const BUDGET_IMPORT_AI_MAX_ROWS = 40;
const BUDGET_IMPORT_AI_MAX_COLS = 24;

function hasMeaningfulBudgetImportCells(matrix: string[][]): boolean {
  return (matrix || []).some((row) => (row || []).some((cell) => String(cell ?? '').trim() !== ''));
}

export function buildBudgetImportAiMatrixSample(matrix: string[][]): string[][] {
  return (matrix || [])
    .slice(0, BUDGET_IMPORT_AI_MAX_ROWS)
    .map((row) => (row || []).slice(0, BUDGET_IMPORT_AI_MAX_COLS).map((cell) => String(cell ?? '')));
}

export function resolveBudgetImportAiSheetName(params: {
  tab: BudgetImportSourceMode;
  selectedSheetName?: string;
  fileName?: string;
}): string {
  const selectedSheetName = String(params.selectedSheetName || '').trim();
  if (selectedSheetName) return selectedSheetName;
  if (params.tab === 'paste') return '예산총괄(복붙)';
  const fileName = String(params.fileName || '').trim();
  return fileName ? `예산총괄(${fileName})` : '예산총괄';
}

export function buildBudgetImportAiRequestKey(params: {
  tenantId: string;
  projectId: string;
  sheetName: string;
  matrix: string[][];
}): string {
  return JSON.stringify({
    tenantId: params.tenantId,
    projectId: params.projectId,
    sheetName: params.sheetName,
    matrix: buildBudgetImportAiMatrixSample(params.matrix),
  });
}

export function shouldAnalyzeBudgetImportWithAi(input: BudgetImportAiDecisionInput): boolean {
  if (!input.open || !input.platformApiEnabled) return false;
  if (!String(input.tenantId || '').trim() || !String(input.projectId || '').trim()) return false;
  if (!hasMeaningfulBudgetImportCells(input.matrix)) return false;
  if (input.importedRowCount === 0) return true;
  if (input.formatGuideRecommended) return true;
  if ((input.warningCount || 0) > 0) return true;
  return input.confidence === 'medium' || input.confidence === 'low';
}
