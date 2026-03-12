import { describe, expect, it, vi } from 'vitest';
import {
  createGoogleSheetsService,
  extractSpreadsheetGid,
  extractSpreadsheetId,
} from './google-sheets.mjs';

describe('google-sheets helpers', () => {
  it('extracts spreadsheet ids from docs links and raw ids', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1abcDEFghiJKlmnOPQ_rst-123/edit#gid=0'))
      .toBe('1abcDEFghiJKlmnOPQ_rst-123');
    expect(extractSpreadsheetId('1abcDEFghiJKlmnOPQ_rst-123'))
      .toBe('1abcDEFghiJKlmnOPQ_rst-123');
    expect(extractSpreadsheetId('not-a-sheet-link')).toBe('');
  });

  it('extracts gid when present', () => {
    expect(extractSpreadsheetGid('https://docs.google.com/spreadsheets/d/1abcDEFghiJKlmnOPQ_rst-123/edit#gid=18273'))
      .toBe(18273);
    expect(extractSpreadsheetGid('https://docs.google.com/spreadsheets/d/1abcDEFghiJKlmnOPQ_rst-123/edit'))
      .toBeNull();
  });

  it('previews spreadsheet metadata and selected sheet values', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        properties: { title: '사업비 시트' },
        sheets: [
          { properties: { sheetId: 0, title: '요약', index: 0 } },
          { properties: { sheetId: 18273, title: '주간정산', index: 1 } },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        values: [
          ['작성자', '거래일시', '지급처'],
          ['홍길동', '2026-03-12', '카페 메리'],
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const service = createGoogleSheetsService({
      fetchImpl,
      authHeadersFactory: async () => ({ authorization: 'Bearer test-token' }),
    });

    const preview = await service.previewSpreadsheet({
      value: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKlmnOPQ_rst-123/edit#gid=18273',
    });

    expect(preview.spreadsheetTitle).toBe('사업비 시트');
    expect(preview.selectedSheetName).toBe('주간정산');
    expect(preview.availableSheets).toHaveLength(2);
    expect(preview.matrix[1]).toEqual(['홍길동', '2026-03-12', '카페 메리']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('prefers caller google access token over service account auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        properties: { title: '사업비 시트' },
        sheets: [
          { properties: { sheetId: 0, title: '사용내역', index: 0 } },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        values: [
          ['작성자', '거래일시'],
          ['홍길동', '2026-03-12'],
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    const authHeadersFactory = vi.fn(async () => ({ authorization: 'Bearer service-account-token' }));
    const service = createGoogleSheetsService({ fetchImpl, authHeadersFactory });

    await service.previewSpreadsheet({
      value: 'https://docs.google.com/spreadsheets/d/1abcDEFghiJKlmnOPQ_rst-123/edit#gid=0',
      accessToken: 'user-google-token',
    });

    expect(authHeadersFactory).not.toHaveBeenCalled();
    const firstHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders.authorization).toBe('Bearer user-google-token');
  });
});
