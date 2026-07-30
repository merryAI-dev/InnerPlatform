import { describe, expect, it, vi } from 'vitest';
import type {
  CashflowMonthCloseMonthShard,
  CashflowMonthCloseMonthShardPage,
  CashflowMonthCloseRequest,
} from '../../lib/platform-bff-client';
import {
  loadCumulativeSettlementMonthPages,
  validateCumulativeSettlementMonthPage,
} from './CumulativeSettlementMonthDetails';

function monthRange(from: string, count: number) {
  const [startYear, startMonth] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = startMonth - 1 + index;
    return `${startYear + Math.floor(offset / 12)}-${String((offset % 12) + 1).padStart(2, '0')}`;
  });
}

function shard(yearMonth: string): CashflowMonthCloseMonthShard {
  return {
    contractVersion: 'cashflow-cumulative-close-v2',
    requestId: 'p1773817948751-2026-07',
    projectId: 'p1773817948751',
    yearMonth,
    shardHash: `hash-${yearMonth}`,
    cells: [],
    source: {} as CashflowMonthCloseMonthShard['source'],
  };
}

const request = {
  documentType: 'MONTHLY_CLOSE',
  contractVersion: 'cashflow-cumulative-close-v2',
  requestId: 'p1773817948751-2026-07',
  projectId: 'p1773817948751',
  yearMonth: '2026-07',
  fromMonth: '2023-01',
  status: 'PENDING',
  revision: 1,
  manifestHash: 'manifest-43',
  monthCount: 43,
  weekCount: 215,
  cellCount: 6880,
  lockRange: { fromMonth: '2023-01', fromWeekNo: 1, throughMonth: '2026-07', throughWeekNo: 5 },
  approverUid: 'head-1',
  requestedByUid: 'pm-1',
  requestedAt: '2026-07-30T00:00:00.000Z',
  reviewedByUid: null,
  reviewedAt: null,
  decisionReason: null,
  reviewWarnings: [],
  monthSnapshot: null,
} satisfies CashflowMonthCloseRequest;

function page(months: string[], nextCursor: string | null, patch: Partial<CashflowMonthCloseMonthShardPage> = {}): CashflowMonthCloseMonthShardPage {
  return {
    requestId: request.requestId,
    requestRevision: request.revision,
    manifestHash: request.manifestHash!,
    monthCount: request.monthCount!,
    months: months.map(shard),
    nextCursor,
    ...patch,
  };
}

describe('CumulativeSettlementMonthDetails evidence readiness', () => {
  it('loads a 43-month request in four bounded sequential pages and becomes ready only after the final page', async () => {
    const expected = monthRange('2023-01', 43);
    const pages = [
      page(expected.slice(0, 12), expected[12]),
      page(expected.slice(12, 24), expected[24]),
      page(expected.slice(24, 36), expected[36]),
      page(expected.slice(36), null),
    ];
    const fetchPage = vi.fn(async ({ cursor, limit }: { cursor?: string; limit: number }) => {
      expect(limit).toBe(12);
      const index = fetchPage.mock.calls.length - 1;
      expect(cursor).toBe(index === 0 ? undefined : expected[index * 12]);
      return pages[index];
    });
    const progress: Array<{ count: number; ready: boolean }> = [];

    const result = await loadCumulativeSettlementMonthPages({
      request,
      fetchPage,
      onProgress: (state) => progress.push({ count: state.months.length, ready: state.ready }),
    });

    expect(fetchPage).toHaveBeenCalledTimes(4);
    expect(progress).toEqual([
      { count: 12, ready: false },
      { count: 24, ready: false },
      { count: 36, ready: false },
      { count: 43, ready: true },
    ]);
    expect(result).toMatchObject({ ready: true, nextCursor: null });
    expect(result.months.map((month) => month.yearMonth)).toEqual(expected);
  });

  it('does not mark the first page ready and preserves single-page compatibility', () => {
    const expected = monthRange('2023-01', 43);
    expect(validateCumulativeSettlementMonthPage(request, [], page(expected.slice(0, 12), expected[12]))).toMatchObject({
      ready: false,
      nextCursor: '2024-01',
    });

    const singleRequest = { ...request, yearMonth: '2023-03', monthCount: 3, weekCount: 15, cellCount: 480, lockRange: { ...request.lockRange!, throughMonth: '2023-03' } };
    expect(validateCumulativeSettlementMonthPage(singleRequest, [], page(monthRange('2023-01', 3), null, { monthCount: 3 }))).toMatchObject({
      ready: true,
      nextCursor: null,
    });
  });

  it.each([
    ['duplicate month', page([...monthRange('2023-01', 11), '2023-11'], '2024-01')],
    ['month gap', page([...monthRange('2023-01', 11), '2024-01'], '2024-02')],
    ['stale manifest', page(monthRange('2023-01', 12), '2024-01', { manifestHash: 'stale' })],
    ['stale revision', page(monthRange('2023-01', 12), '2024-01', { requestRevision: 2 })],
    ['stale request id', page(monthRange('2023-01', 12), '2024-01', { requestId: 'other-request' })],
    ['stale month count', page(monthRange('2023-01', 12), '2024-01', { monthCount: 42 })],
    ['early final count', page(monthRange('2023-01', 12), null)],
  ])('rejects %s without readiness', (_label, invalidPage) => {
    expect(() => validateCumulativeSettlementMonthPage(request, [], invalidPage)).toThrow();
  });

  it('rejects a final page whose accumulated count is short of 43', () => {
    const expected = monthRange('2023-01', 43);
    expect(() => validateCumulativeSettlementMonthPage(
      request,
      expected.slice(0, 36).map(shard),
      page(expected.slice(36, 42), null),
    )).toThrow('전체 월 수보다 일찍 끝났습니다');
  });

  it('preserves verified pages when a later page fails so retry can resume from that cursor', async () => {
    const expected = monthRange('2023-01', 43);
    const progress: Array<{ count: number; ready: boolean }> = [];
    const firstPageMonths = expected.slice(0, 12).map(shard);
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page(expected.slice(0, 12), expected[12]))
      .mockRejectedValueOnce(new Error('timeout'));

    await expect(loadCumulativeSettlementMonthPages({
      request,
      fetchPage,
      onProgress: (state) => progress.push({ count: state.months.length, ready: state.ready }),
    })).rejects.toThrow('timeout');

    expect(progress).toEqual([{ count: 12, ready: false }]);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: '2024-01', limit: 12 });

    const retryFetch = vi.fn()
      .mockResolvedValueOnce(page(expected.slice(12, 24), expected[24]))
      .mockResolvedValueOnce(page(expected.slice(24, 36), expected[36]))
      .mockResolvedValueOnce(page(expected.slice(36), null));
    const retried = await loadCumulativeSettlementMonthPages({
      request,
      startMonths: firstPageMonths,
      startCursor: expected[12],
      fetchPage: retryFetch,
    });
    expect(retryFetch).toHaveBeenCalledTimes(3);
    expect(retried).toMatchObject({ ready: true, nextCursor: null });
    expect(retried.months).toHaveLength(43);
  });
});
