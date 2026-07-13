import { describe, expect, it, vi } from 'vitest';
import {
  applyCashflowSheetLabViaBff,
  extractSpreadsheetIdFromSheetInput,
  getCashflowSheetLabMirrorViaBff,
  getCashflowSheetLabShareAccountViaBff,
  previewCashflowSheetLabViaBff,
  refreshCashflowSheetLabMirrorViaBff,
  saveCashflowSheetLabConfigViaBff,
  stageCashflowSheetLabViaBff,
} from './sheets-cashflow-readonly-client';

const lease = { sessionId: 'session-a', leaseId: 'lease-a', fence: 7 };

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

  it('uses the service-account lab preview endpoint without Google OAuth token headers', async () => {
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
            valueSource: 'firebase_cashflow_weeks',
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
          previewValues: [{ mode: 'actual', lineId: 'SALES_IN', direction: 'IN', yearMonth: '2026-01', weekNo: 1, rowIndex: 1, columnIndex: 2, a1: 'C2', sheetValue: '원본', amount: 1000, source: 'firebase_cashflow_weeks' }],
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
    expect(client.post.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it('saves sheet lab config through same-origin BFF', async () => {
    const client = asMockClient({
      request: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          configured: true,
          config: {
            value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
            sheetName: 'cashflow(사용내역 연동)',
            spreadsheetId: 'sheet-001',
            startWeek: '26-1-1',
            endWeek: '26-12-5',
          },
          systemAccountEmail: 'cashflow-service@mysc.iam.gserviceaccount.com',
        },
      })),
    });

    await saveCashflowSheetLabConfigViaBff({
      tenantId: 'mysc',
      actor: {
        uid: 'user-1',
        role: 'workspace_user',
        email: 'user@mysc.co.kr',
        idToken: 'firebase-token',
      },
      projectId: 'p001',
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
      sheetName: 'cashflow(사용내역 연동)',
      startWeek: '26-1-1',
      endWeek: '26-12-5',
      client,
    });

    expect(client.request).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/config',
      expect.objectContaining({
        method: 'PUT',
        tenantId: 'mysc',
        body: {
          value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-12-5',
        },
      }),
    );
    expect(client.request.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it('final-applies explicitly provided sheet values and atomically finalizes the lease', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          spreadsheetId: 'sheet-001',
          spreadsheetTitle: 'cashflow',
          selectedSheetName: 'cashflow(사용내역 연동)',
          appliedLineCount: 24,
          projectionLineCount: 12,
          actualLineCount: 12,
          firebaseResult: {
            ok: true,
            commandName: 'cashflowSheetLab.apply.firebase',
            projectId: 'p001',
            sourceSheetKey: 'cashflow-sheet-lab',
            savedProjectionLineCount: 12,
            savedActualLineCount: 12,
            updatedWeeks: [],
          },
        },
      })),
    });

    await applyCashflowSheetLabViaBff({
      tenantId: 'mysc',
      actor: { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' },
      projectId: 'p001',
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
      sheetName: 'cashflow(사용내역 연동)',
      startWeek: '26-1-1',
      endWeek: '26-6-5',
      idempotencyKey: 'apply-001',
      lease,
      finalize: true,
      client,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/apply',
      expect.objectContaining({
        tenantId: 'mysc',
        body: {
          value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-6-5',
          idempotencyKey: 'apply-001',
        },
        idempotencyKey: 'apply-001',
        headers: {
          'x-edit-session-id': 'session-a',
          'x-edit-lease-id': 'lease-a',
          'x-edit-fence': '7',
          'x-edit-finalize': 'true',
        },
      }),
    );
  });

  it('reads only the pinned mirror without contacting Google Sheets', async () => {
    const client = asMockClient({
      get: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          status: 'FRESH',
          sourceRevision: 'sha256:source-001',
          targetRevisionAtFetch: 'sha256:target-001',
          capturedAt: '2026-07-13T01:00:00.000Z',
          summary: { cellCount: 1920, valueCount: 20, emptyCount: 1900, invalidCount: 0 },
          cells: [],
        },
      })),
    });

    const result = await getCashflowSheetLabMirrorViaBff({
      tenantId: 'mysc',
      actor: { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' },
      projectId: 'p001',
      client,
    });

    expect(result.status).toBe('FRESH');
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/mirror',
      expect.objectContaining({ tenantId: 'mysc' }),
    );
    expect(client.post).not.toHaveBeenCalled();
  });

  it('refreshes the mirror only on an explicit request and retains a stale last-good snapshot', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          status: 'STALE',
          sourceRevision: 'sha256:last-good',
          targetRevisionAtFetch: 'sha256:target-001',
          capturedAt: '2026-07-13T01:00:00.000Z',
          summary: { cellCount: 1, valueCount: 1, emptyCount: 0, invalidCount: 0 },
          cells: [{
            mode: 'projection', yearMonth: '2026-01', weekNo: 1, lineId: 'SALES_IN',
            direction: 'IN', sourceCell: 'D14', sourceLabel: '매출액(입금)', state: 'VALUE', amount: 1000,
          }],
          lastRefreshError: { code: 'sheet_unavailable', message: '시트를 읽지 못했습니다.', at: '2026-07-13T02:00:00.000Z' },
        },
      })),
    });

    const result = await refreshCashflowSheetLabMirrorViaBff({
      tenantId: 'mysc',
      actor: { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' },
      projectId: 'p001',
      value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
      sheetName: 'cashflow(사용내역 연동)',
      startWeek: '26-1-1',
      endWeek: '26-6-5',
      idempotencyKey: 'refresh-001',
      client,
    });

    expect(result).toMatchObject({
      status: 'STALE',
      sourceRevision: 'sha256:last-good',
      capturedAt: '2026-07-13T01:00:00.000Z',
      cells: [expect.objectContaining({ amount: 1000 })],
    });
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/mirror/refresh',
      expect.objectContaining({
        tenantId: 'mysc',
        body: {
          value: 'https://docs.google.com/spreadsheets/d/sheet-001/edit',
          sheetName: 'cashflow(사용내역 연동)',
          startWeek: '26-1-1',
          endWeek: '26-6-5',
          idempotencyKey: 'refresh-001',
        },
        idempotencyKey: 'refresh-001',
      }),
    );
  });

  it('stages the explicitly selected pinned revision through the review endpoint', async () => {
    const client = asMockClient({
      post: vi.fn(async () => ({
        data: {
          ok: true,
          commandName: 'cashflowSheetLab.stage.firebase',
          projectId: 'p001',
          runId: 'stage-run-1',
          stagedLineCount: 4,
          projectionLineCount: 2,
          actualLineCount: 2,
          riskLineCount: 1,
          candidates: [],
        },
      })),
    });

    const result = await stageCashflowSheetLabViaBff({
      tenantId: 'mysc',
      actor: { uid: 'user-1', role: 'workspace_user', email: 'user@mysc.co.kr' },
      projectId: 'p001',
      expectedMirrorRevision: 'sha256:source-001',
      idempotencyKey: 'stage-001',
      client,
    });

    expect(result.stagedLineCount).toBe(4);
    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/stage',
      expect.objectContaining({
        tenantId: 'mysc',
        body: {
          expectedMirrorRevision: 'sha256:source-001',
          idempotencyKey: 'stage-001',
        },
        idempotencyKey: 'stage-001',
      }),
    );
    expect(client.post.mock.calls[0]?.[1]?.headers).toBeUndefined();
  });

  it('loads the service account share target manually through same-origin BFF', async () => {
    const client = asMockClient({
      get: vi.fn(async () => ({
        data: {
          projectId: 'p001',
          configured: false,
          config: null,
          systemAccountEmail: 'cashflow-service@mysc.iam.gserviceaccount.com',
          accessPolicy: {
            googleAuth: 'service_account',
            serviceAccountEmail: 'cashflow-service@mysc.iam.gserviceaccount.com',
            sheetPermission: 'shared_with_mysc_system_account',
          },
        },
      })),
    });

    const result = await getCashflowSheetLabShareAccountViaBff({
      tenantId: 'mysc',
      actor: {
        uid: 'user-1',
        role: 'workspace_user',
        email: 'user@mysc.co.kr',
        idToken: 'firebase-token',
      },
      projectId: 'p001',
      client,
    });

    expect(result.systemAccountEmail).toBe('cashflow-service@mysc.iam.gserviceaccount.com');
    expect(client.get).toHaveBeenCalledWith(
      '/api/v1/projects/p001/cashflow-sheet-lab/config',
      expect.objectContaining({
        tenantId: 'mysc',
        actor: expect.objectContaining({
          id: 'user-1',
          email: 'user@mysc.co.kr',
          role: 'workspace_user',
          idToken: 'firebase-token',
        }),
      }),
    );
    expect(client.get.mock.calls[0]?.[1]?.headers).toBeUndefined();
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
        valueSource: 'firebase_cashflow_weeks',
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

    const firstCall = fetchImpl.mock.calls.at(0) as unknown[] | undefined;
    expect(firstCall?.[0]).toBe('/api/v1/projects/p001/cashflow-sheet-lab/preview');
  });
});
