export const SPREADSHEET_ERROR_CODES = [
  '#REF!',
  '#N/A',
  '#VALUE!',
  '#NAME?',
  '#DIV/0!',
  '#NUM!',
  '#NULL!',
  '#SPILL!',
  '#CALC!',
] as const;

export type SpreadsheetErrorCode = (typeof SPREADSHEET_ERROR_CODES)[number];
export type SpreadsheetFormulaIssueKind = 'literal_formula_error' | 'propagated_formula_error';

export interface SpreadsheetFormulaIssue {
  kind: SpreadsheetFormulaIssueKind;
  errorCode: SpreadsheetErrorCode;
}

export function findSpreadsheetError(value: string): SpreadsheetErrorCode | null {
  const normalized = String(value || '').toUpperCase();
  return (
    SPREADSHEET_ERROR_CODES.find((code) => normalized.includes(code.toUpperCase())) || null
  );
}

export function detectSpreadsheetFormulaIssue(
  formula: string,
  result: string,
): SpreadsheetFormulaIssue | null {
  const literalErrorCode = findSpreadsheetError(formula);
  if (literalErrorCode) {
    return {
      kind: 'literal_formula_error',
      errorCode: literalErrorCode,
    };
  }

  const propagatedErrorCode = findSpreadsheetError(result);
  if (propagatedErrorCode) {
    return {
      kind: 'propagated_formula_error',
      errorCode: propagatedErrorCode,
    };
  }

  return null;
}
