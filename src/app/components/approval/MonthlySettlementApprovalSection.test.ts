import { describe, expect, it, vi } from 'vitest';
import { fetchPendingCashflowMonthCloseRequestsViaBff, type PlatformApiClientLike } from '../../lib/platform-bff-client';
import {
  buildMonthCloseHistoryEntries,
  formatDateTime,
  formatMoney,
  resolveRequestPartyName,
} from './MonthlySettlementApprovalSection';

describe('MonthlySettlementApprovalSection cumulative totals', () => {
  it('formats the persisted request time in Asia/Seoul and resolves document parties from members', () => {
    const members = [
      { uid: 'pm-1', name: '변민욱(보람)', email: 'pm@example.com', role: 'pm' as const },
      { uid: 'finance-1', name: '(AX) AI', email: 'ai@example.com', role: 'finance' as const },
    ];

    expect(formatDateTime('2026-07-10T00:00:00.000Z')).toBe('2026. 07. 10. 09:00');
    expect(resolveRequestPartyName('서버 요청자', members, 'pm-1')).toBe('서버 요청자');
    expect(resolveRequestPartyName('', members, 'finance-1')).toBe('(AX) AI');
    expect(resolveRequestPartyName('', members, 'missing')).toBe('구성원 이름 확인 불가');
  });

  it('renders the persisted BFF scalar totals through the client without undefined money values', async () => {
    const request = {
      contractVersion: 'cashflow-cumulative-close-v2',
      documentType: 'MONTHLY_CLOSE',
      requestId: 'p1773817948751-2026-07',
      projectId: 'p1773817948751',
      yearMonth: '2026-07',
      status: 'PENDING',
      revision: 1,
      fromMonth: '2023-01',
      monthCount: 43,
      weekCount: 215,
      cellCount: 6880,
      lockRange: { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-07', throughWeekNo: 5 },
      source: {
        sourceRevision: 'source-1',
        targetRevision: 'target-1',
        capturedAt: '2026-07-10T00:00:00.000Z',
        spreadsheetId: 'sheet-1',
        spreadsheetTitle: 'AXR프로젝트경비경',
        selectedSheetName: 'cashflow(사용내역 연동)',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      },
      totals: { projection: 1200, actual: 900, difference: -300 },
      annualSummaries: [
        { year: 2026, monthCount: 8, projection: 1200, actual: 900, difference: -300 },
      ],
      approverUid: 'finance-1',
      approverName: '(AX) AI',
      requestedByUid: 'pm-1',
      requestedByName: '변민욱(보람)',
      requestedAt: '2026-09-10T00:00:00.000Z',
      reviewedByUid: null,
      reviewedAt: null,
      decisionReason: null,
      reviewWarnings: [],
      monthSnapshot: null,
    };
    const client = {
      get: vi.fn(async () => ({ data: { items: [request] } })),
      post: vi.fn(),
      request: vi.fn(),
    } as unknown as PlatformApiClientLike;

    const [result] = await fetchPendingCashflowMonthCloseRequestsViaBff({
      tenantId: 'mysc', actor: { uid: 'finance-1', role: 'finance' }, client,
    });

    expect(formatMoney(result.totals?.projection)).toBe('1,200원');
    expect(formatMoney(result.annualSummaries?.[0].actual)).toBe('900원');
    expect(formatMoney(result.annualSummaries?.[0].difference)).toBe('-300원');
    expect(formatMoney(undefined)).toBe('—');
    expect(result).toMatchObject({
      documentType: 'MONTHLY_CLOSE',
      requestId: 'p1773817948751-2026-07',
      yearMonth: '2026-07',
      monthCount: 43,
      weekCount: 215,
      cellCount: 6880,
      lockRange: { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-07', throughWeekNo: 5 },
      source: {
        spreadsheetTitle: 'AXR프로젝트경비경',
        selectedSheetName: 'cashflow(사용내역 연동)',
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      },
    });
  });

  it('builds persisted request, review, and recovery history without exposing UIDs', () => {
    const request = {
      documentType: 'MONTHLY_CLOSE', requestId: 'request-1', projectId: 'project-a', yearMonth: '2026-07',
      status: 'UNCERTAIN', revision: 1, requestedByUid: 'uid-requester', requestedByName: '변민욱(보람)',
      approverUid: 'uid-approver', approverName: '(AX) AI', requestedAt: '2026-07-30T07:27:41.384Z',
      reviewedByUid: 'uid-approver', reviewedByName: '(AX) AI', reviewedAt: '2026-07-30T07:30:00.000Z',
      decisionReason: '확인 중', reviewWarnings: [], monthSnapshot: null,
      lockRange: { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-07', throughWeekNo: 5 }, monthCount: 43,
    } as Parameters<typeof buildMonthCloseHistoryEntries>[0];

    const entries = buildMonthCloseHistoryEntries(request, []);

    expect(entries).toEqual([
      expect.objectContaining({ kind: 'REQUESTED', actorName: '변민욱(보람)', at: '2026-07-30T07:27:41.384Z' }),
      expect.objectContaining({ kind: 'REVIEWED', actorName: '(AX) AI', at: '2026-07-30T07:30:00.000Z', detail: '확인 중' }),
      expect.objectContaining({ kind: 'RECOVERY', actorName: '(AX) AI' }),
    ]);
    expect(JSON.stringify(entries)).not.toContain('uid-requester');
    expect(JSON.stringify(entries)).not.toContain('uid-approver');
  });
});
