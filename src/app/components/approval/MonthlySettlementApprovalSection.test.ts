import { describe, expect, it, vi } from 'vitest';
import { fetchPendingCashflowMonthCloseRequestsViaBff, type PlatformApiClientLike } from '../../lib/platform-bff-client';
import { formatMoney } from './MonthlySettlementApprovalSection';

describe('MonthlySettlementApprovalSection cumulative totals', () => {
  it('renders the persisted BFF scalar totals through the client without undefined money values', async () => {
    const request = {
      contractVersion: 'cashflow-cumulative-close-v2',
      requestId: 'project-a-2026-08',
      projectId: 'project-a',
      yearMonth: '2026-08',
      status: 'PENDING',
      revision: 1,
      totals: { projection: 1200, actual: 900, difference: -300 },
      annualSummaries: [
        { year: 2026, monthCount: 8, projection: 1200, actual: 900, difference: -300 },
      ],
      approverUid: 'finance-1',
      requestedByUid: 'pm-1',
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
  });
});
