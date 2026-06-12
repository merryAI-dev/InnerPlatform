import { describe, expect, it, vi } from 'vitest';
import {
  extractSpreadsheetIdFromSheetInput,
  getCashflowSheetLabConfigViaBff,
  previewCashflowSheetLabViaBff,
  saveCashflowSheetLabConfigViaBff,
} from './sheets-cashflow-readonly-client';

function asMockClient(client: {
  post?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
  request?: ReturnType<typeof vi.fn>;
}) {
  return {
    get: client.get || vi.fn(),
    post: client.post || vi.fn(),
    patch: client.patch || vi.fn(),
    request: client.request || vi.fn(),
  };
}

describe('sheets cashflow readonly client', () => {
  it('extracts spreadsheet ids for immediate input feedback', () => {
    expect(extractSpreadsheetIdFromSheetInput('https://docs.google.com/spreadsheets/d/sheet_12345678901234567890/edit#gid=1')).toBe('sheet_12345678901234567890');
    expect(extractSpreadsheetIdFromSheetInput('https://drive.google.com/open?id=sheet-12345678901234567890')).toBe('sheet-12345678901234567890');
    expect(extractSpreadsheetIdFromSheetInput('sheet_12345678901234567890')).toBe('sheet_12345678901234567890');
    expect(extractSpreadsheetIdFromSheetInput('not a sheet')).toBe('');
  });

  it('calls the lab preview endpoint without passing user Google OAuth tokens', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          spreadsheetId: 'sheet-001',
          spreadsheetTitle: 'cashflow',
          selectedSheetName: 'cashflow(사용내역 연동)',
          availableSheets: [],
          matrix: [],
          accessPolicy: {
            googleAuth: 'service_account',
            googleScope: 'spreadsheets.readonly',
            sheetPermission: 'shared_with_mysc_system_account',
            layoutSource: 'google_sheet_formatted_values',
            valueSource: 'java_cashflow_read_model',
            actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
            sheetReadRange: 'A1:ZZ220',
            sheetPreviewCache: 'miss',
            sheetNamePolicy: 'cashflow_usage_linked_only',
          },
          template: {
            supported: true,
            policyVersion: 'cashflow-policy-v1',
            sectionOrder: ['projection', 'actual'],
            sections: [],
            mappingCandidates: [],
            derivedRows: [],
            ignoredRows: [],
            reasons: [],
            stats: { rowCount: 0, maxColumnCount: 0, sectionCount: 0, mappingCount: 0 },
          },
          previewValues: [{ mode: 'actual', lineId: 'SALES_IN', direction: 'IN', yearMonth: '2026-01', weekNo: 1, rowIndex: 1, columnIndex: 2, a1: 'C2', sheetValue: '원본', amount: 1000, source: 'java_read_model' }],
          cashflowSnapshotStatus: 'pending',
          cashflowSnapshotError: null,
        },
      })),
    });

    await previewCashflowSheetLabViaBff({
      tenantId: 'mysc',
      actor: {
        uid: 'user-1',
        role: 'workspace_user',
        email: 'user@mysc.co.kr',
        idToken: 'firebase-token',
        googleAccessToken: 'must-not-forward',
      },
      projectId: 'p001',
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
      sheetName: 'cashflow(사용내역 연동)',
      includeValues: false,
      client,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/preview',
      expect.objectContaining({
        tenantId: 'mysc',
        actor: expect.objectContaining({
          id: 'user-1',
          email: 'user@mysc.co.kr',
          role: 'workspace_user',
          idToken: 'firebase-token',
        }),
        body: {
          value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
          sheetName: 'cashflow(사용내역 연동)',
          includeValues: false,
        },
      }),
    );
    expect(client.post.mock.calls[0][1].headers).toBeUndefined();
  });

  it('reads and saves the persisted lab sheet config through same-origin BFF', async () => {
    const client = asMockClient({
      get: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          configured: true,
          config: {
            value: 'sheet-001',
            sheetName: 'cashflow(사용내역 연동)',
            spreadsheetId: 'sheet-001',
          },
        },
      })),
      request: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          configured: true,
          config: {
            value: 'sheet-001',
            sheetName: 'cashflow(사용내역 연동)',
            spreadsheetId: 'sheet-001',
          },
        },
      })),
    });
    const actor = { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' };

    await getCashflowSheetLabConfigViaBff({
      tenantId: 'mysc',
      actor,
      projectId: 'p001',
      client,
    });
    await saveCashflowSheetLabConfigViaBff({
      tenantId: 'mysc',
      actor,
      projectId: 'p001',
      value: 'sheet-001',
      sheetName: 'cashflow(사용내역 연동)',
      startWeek: '26-1-1',
      endWeek: '26-6-5',
      client,
    });

    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/config',
      expect.objectContaining({ tenantId: 'mysc' }),
    );
    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/config',
      expect.objectContaining({
        method: 'PUT',
        body: {
          value: 'sheet-001',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-6-5',
        },
      }),
    );
  });

  it('uses same-origin BFF instead of the global Java API base URL', async () => {
    const originalFetch = globalThis.fetch;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      projectId: 'p001',
      spreadsheetId: 'sheet-001',
      spreadsheetTitle: 'cashflow',
      selectedSheetName: 'cashflow(사용내역 연동)',
      availableSheets: [],
      matrix: [],
      accessPolicy: {
        googleAuth: 'service_account',
        googleScope: 'spreadsheets.readonly',
        sheetPermission: 'shared_with_mysc_system_account',
        layoutSource: 'google_sheet_formatted_values',
        valueSource: 'java_cashflow_read_model',
        actorRolePolicy: 'mysc_email_maps_to_workspace_user_for_read',
        sheetReadRange: 'A1:ZZ220',
        sheetPreviewCache: 'miss',
        sheetNamePolicy: 'cashflow_usage_linked_only',
      },
      template: {
        supported: true,
        policyVersion: 'cashflow-policy-v1',
        sectionOrder: ['projection', 'actual'],
        sections: [],
        mappingCandidates: [],
        derivedRows: [],
        ignoredRows: [],
        reasons: [],
        stats: { rowCount: 0, maxColumnCount: 0, sectionCount: 0, mappingCount: 0 },
      },
      previewValues: [],
      cashflowSnapshotStatus: 'pending',
      cashflowSnapshotError: null,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchImpl);

    try {
      await previewCashflowSheetLabViaBff({
        tenantId: 'mysc',
        actor: { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' },
        projectId: 'p001',
        value: 'sheet-001',
        includeValues: false,
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/projects/p001/cashflow-sheet-lab/preview');
  });
});
