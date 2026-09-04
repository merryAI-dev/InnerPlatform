import { describe, expect, it, vi } from 'vitest';
import { readCashflowStatus, resolveCashflowMcpConfig } from './cashflow-status.mjs';

const input = {
  baseUrl: 'https://myscube.myscguard.app',
  accessToken: 'oauth-token',
  projectIds: ['project-a'],
  yearMonth: '2026-08',
  requestId: 'request-1',
};

function okResponse(version = '5', errors = []) {
  const commandCapabilities = Object.fromEntries([
    'SUBMIT_MONTH_CLOSE', 'WITHDRAW_MONTH_CLOSE', 'APPROVE_MONTH_CLOSE', 'REJECT_MONTH_CLOSE',
    'REQUEST_MONTH_REOPEN', 'APPROVE_MONTH_REOPEN', 'REJECT_MONTH_REOPEN', 'CANCEL_ACTIVE_CYCLE',
  ].map((command) => [command, { allowed: false, reasonCode: 'BUSINESS_STATE_NOT_ELIGIBLE' }]));
  commandCapabilities.SUBMIT_MONTH_CLOSE = { allowed: true, reasonCode: '' };
  return new Response(JSON.stringify({
    version,
    yearMonth: '2026-08',
    monthCloseTargetYearMonth: '2026-07',
    monthCloseTargetLabel: '7월',
    items: [{
      projectId: 'project-a',
      settlementStatuses: {
        projectId: 'project-a', yearMonth: '2026-08',
        items: [
          {
            period: 'MONTH', status: 'WAITING_FOR_UPDATE',
            deadlineAt: '2026-08-10T15:00:00.000Z', approverDeadlineAt: '2026-08-31T15:00:00.000Z',
            submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 0,
          },
          {
            period: 'WEEK_1', status: 'PENDING_APPROVAL',
            deadlineAt: '2026-08-02T15:00:00.000Z', approverDeadlineAt: '2026-08-03T04:00:00.000Z',
            submittedAt: '2026-08-03T01:00:00.000Z', submittedBy: 'pm-1', approvedAt: '', approvedBy: '', revision: 1,
          },
          ...Array.from({ length: 4 }, (_, index) => ({
            period: `WEEK_${index + 2}`, status: 'WAITING_FOR_UPDATE',
            deadlineAt: '2026-08-06T15:00:00.000Z', approverDeadlineAt: '2026-08-07T04:00:00.000Z',
            submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 0,
          })),
        ],
      },
      projectionActualSummary: null,
      sheetCapturedAt: null,
      settlementCycle: {
        cycleYearMonth: '2026-08', weeklyYearMonth: '2026-08', monthCloseTargetYearMonth: '2026-07',
        businessState: 'NOT_REQUESTED', health: 'OK', workflowRevision: 0,
        monthCloseSettlement: null, provenance: null, supersededAttempt: null, commandCapabilities,
      },
    }],
    errors,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mutateResponse(mutate) {
  const response = okResponse();
  return response.json().then((result) => {
    mutate(result);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('readCashflowStatus', () => {
  it('uses the OAuth-only read endpoint without actor or tenant headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await readCashflowStatus({ ...input, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://myscube.myscguard.app/api/v1/mcp/cashflow/weekly-overview');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      authorization: 'Bearer oauth-token',
      'content-type': 'application/json',
      'x-request-id': 'request-1',
    });
  });

  it('rejects invalid input before making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(readCashflowStatus({ ...input, projectIds: ['bad/id'], fetchImpl })).rejects.toThrow('프로젝트 식별자');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('needs no Firebase ID token environment variable', async () => {
    expect(resolveCashflowMcpConfig({ MYSCUBE_BFF_BASE_URL: input.baseUrl })).toMatchObject({ baseUrl: `${input.baseUrl}/` });
  });

  it.each(['1', '4'])('rejects legacy weekly overview version %s', async (version) => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(version));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('응답을 확인할 수 없습니다.');
  });

  it('accepts the only public partial result, an unavailable summary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('5', [
      { projectId: 'project-a', code: 'SUMMARY_UNAVAILABLE' },
    ]));

    await expect(readCashflowStatus({ ...input, fetchImpl })).resolves.toMatchObject({ version: '5' });
  });

  it.each([
    ['STATUS_UNAVAILABLE', [{ projectId: 'project-a', code: 'STATUS_UNAVAILABLE' }]],
    ['MONTH_CLOSE_UNAVAILABLE', [{ projectId: 'project-a', code: 'MONTH_CLOSE_UNAVAILABLE' }]],
    ['duplicate summary', [
      { projectId: 'project-a', code: 'SUMMARY_UNAVAILABLE' },
      { projectId: 'project-a', code: 'SUMMARY_UNAVAILABLE' },
    ]],
  ])('rejects non-public or malformed %s errors', async (_label, errors) => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('5', errors));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('응답을 확인할 수 없습니다.');
  });

  it.each(['settlementStatuses', 'settlementCycle'])('rejects an item without canonical %s', async (field) => {
    const fetchImpl = vi.fn().mockResolvedValue(await mutateResponse((result) => { result.items[0][field] = null; }));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('응답을 확인할 수 없습니다.');
  });

  it.each([
    ['foreign settlement project', (result) => { result.items[0].settlementStatuses.projectId = 'foreign'; }],
    ['foreign settlement month', (result) => { result.items[0].settlementStatuses.yearMonth = '2026-07'; }],
    ['foreign cycle', (result) => { result.items[0].settlementCycle.cycleYearMonth = '2026-09'; }],
    ['missing week', (result) => {
      result.items[0].settlementStatuses.items = result.items[0].settlementStatuses.items
        .filter((item) => item.period !== 'WEEK_3');
    }],
    ['legacy MONTH status', (result) => { result.items[0].settlementStatuses.items[0].status = 'COMPLETED'; }],
    ['MONTH-only status on a week', (result) => { result.items[0].settlementStatuses.items[1].status = 'LOCKED'; }],
    ['malformed settlement timestamps', (result) => {
      result.items[0].settlementStatuses.items[1].submittedAt = 'not-an-instant';
      result.items[0].settlementStatuses.items[1].deadlineAt = null;
    }],
    ['malformed capabilities', (result) => {
      delete result.items[0].settlementCycle.commandCapabilities.SUBMIT_MONTH_CLOSE;
    }],
    ['malformed summary and capture time', (result) => {
      result.items[0].projectionActualSummary = 'MALFORMED';
      result.items[0].sheetCapturedAt = 7;
    }],
    ['summary without periods', (result) => {
      result.items[0].projectionActualSummary = {
        projectId: 'project-a', source: 'SHEET_FORMULA', sourceRevision: 'source-1',
        fromMonth: '2026-01', comparisonAsOfWeek: { yearMonth: '2026-08', weekNo: 1 },
        differenceAmount: 0, settlementDifferenceAmount: 0, settlementMatches: true,
        display: { periodLabel: '누적', statusLabel: '일치', statusTone: 'success', differenceLabel: '차액 0원' },
      };
    }],
  ])('rejects a structurally invalid canonical item with %s', async (_label, mutate) => {
    const fetchImpl = vi.fn().mockResolvedValue(await mutateResponse(mutate));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('응답을 확인할 수 없습니다.');
  });

  it('does not expose the token when BFF denies access', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('조회할 권한');
    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.not.toThrow('oauth-token');
  });
});
