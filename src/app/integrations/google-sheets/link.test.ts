import { describe, expect, it } from 'vitest';
import { extractSpreadsheetId } from './link';

describe('Google Sheets link helpers', () => {
  it('extracts spreadsheet IDs from supported Google Sheet inputs', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/sheet_12345678901234567890/edit#gid=1'))
      .toBe('sheet_12345678901234567890');
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/u/1/d/sheet_12345678901234567890/edit#gid=1'))
      .toBe('sheet_12345678901234567890');
    expect(extractSpreadsheetId('https://drive.google.com/open?id=sheet-12345678901234567890'))
      .toBe('sheet-12345678901234567890');
    expect(extractSpreadsheetId('sheet_12345678901234567890'))
      .toBe('sheet_12345678901234567890');
  });

  it('rejects unsupported values', () => {
    expect(extractSpreadsheetId('')).toBe('');
    expect(extractSpreadsheetId('not a sheet')).toBe('');
  });
});
