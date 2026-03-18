import { describe, expect, it } from 'vitest';
import { grid2tsv, parseTsvRows, isSpreadsheetHtml } from './settlement-grid-clipboard';

describe('settlement-grid-clipboard', () => {
  describe('grid2tsv', () => {
    it('joins cells with tabs and rows with newlines', () => {
      const grid = [['A', 'B'], ['C', 'D']];
      expect(grid2tsv(grid)).toBe('A\tB\nC\tD');
    });

    it('quotes fields containing tabs', () => {
      expect(grid2tsv([['a\tb']])).toBe('"a\tb"');
    });

    it('quotes fields containing newlines', () => {
      expect(grid2tsv([['a\nb']])).toBe('"a\nb"');
    });

    it('escapes double quotes inside quoted fields', () => {
      expect(grid2tsv([['say "hello"']])).toBe('"say ""hello"""');
    });
  });

  describe('parseTsvRows', () => {
    it('parses simple tab-separated rows', () => {
      expect(parseTsvRows('A\tB\nC\tD')).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('handles RFC 4180 quoted fields', () => {
      expect(parseTsvRows('"a\tb"\t"c"')).toEqual([['a\tb', 'c']]);
    });

    it('handles escaped double quotes', () => {
      expect(parseTsvRows('"say ""hello"""')).toEqual([['say "hello"']]);
    });

    it('handles CRLF line endings', () => {
      expect(parseTsvRows('A\tB\r\nC\tD')).toEqual([['A', 'B'], ['C', 'D']]);
    });

    it('drops trailing empty line', () => {
      expect(parseTsvRows('A\tB\n')).toEqual([['A', 'B']]);
    });

    it('round-trips with grid2tsv', () => {
      const grid = [['hello', 'world\ttab'], ['line\nnew', '"quotes"']];
      expect(parseTsvRows(grid2tsv(grid))).toEqual(grid);
    });
  });

  describe('isSpreadsheetHtml', () => {
    it('detects Google Sheets HTML', () => {
      expect(isSpreadsheetHtml('<meta name="google-sheets-html-origin">')).toBe(true);
    });

    it('detects Excel HTML', () => {
      expect(isSpreadsheetHtml('<html xmlns:x="urn:schemas-microsoft-com:office:excel">')).toBe(true);
    });

    it('rejects plain HTML', () => {
      expect(isSpreadsheetHtml('<div>hello</div>')).toBe(false);
    });
  });
});
