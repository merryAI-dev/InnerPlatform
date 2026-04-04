import { describe, expect, it } from 'vitest';
import {
  detectSpreadsheetFormulaIssue,
  findSpreadsheetError,
} from './google-sheet-workbook-audit';

describe('google-sheet-workbook-audit', () => {
  it('detects literal formula errors before propagated results', () => {
    expect(
      detectSpreadsheetFormulaIssue(
        "=SUMIFS(#REF!,'그룹지출대장'!H:H,C4)",
        '#N/A',
      ),
    ).toEqual({
      kind: 'literal_formula_error',
      errorCode: '#REF!',
    });
  });

  it('detects propagated spreadsheet errors when the formula text is clean', () => {
    expect(
      detectSpreadsheetFormulaIssue('=SUM(G6:G8)', '#N/A'),
    ).toEqual({
      kind: 'propagated_formula_error',
      errorCode: '#N/A',
    });
  });

  it('returns null when no spreadsheet error is present', () => {
    expect(detectSpreadsheetFormulaIssue('=SUM(A1:A3)', '120000')).toBeNull();
  });

  it('matches the supported spreadsheet error codes', () => {
    expect(findSpreadsheetError('result=#VALUE!')).toBe('#VALUE!');
    expect(findSpreadsheetError('result=#DIV/0!')).toBe('#DIV/0!');
    expect(findSpreadsheetError('result=#CALC!')).toBe('#CALC!');
  });
});
