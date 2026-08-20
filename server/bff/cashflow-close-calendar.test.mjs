import { describe, expect, it } from 'vitest';
import {
  CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
  cumulativeCloseMonthsOrNull,
  monthsBetween,
  previousYearMonth,
  readCashflowCumulativeCloseAuthority,
} from './cashflow-close-calendar.mjs';

describe('cashflow close calendar', () => {
  it('walks months inclusively and wraps years', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(previousYearMonth('2026-01')).toBe('2025-12');
  });

  it('caps the cumulative range at 240 months', () => {
    expect(monthsBetween('2023-01', '2099-12')).toHaveLength(240);
  });

  it('covers 2023-01 through the month before the cycle, or nothing', () => {
    expect(cumulativeCloseMonthsOrNull('2026-08')).toHaveLength(43);
    expect(cumulativeCloseMonthsOrNull('2026-08')?.at(0)).toBe(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH);
    expect(cumulativeCloseMonthsOrNull('2026-08')?.at(-1)).toBe('2026-07');
    // 기점 이전 회차는 성립하지 않는다. HTTP 로 뭐라 말할지는 라우트의 일이다.
    expect(cumulativeCloseMonthsOrNull('2023-01')).toBeNull();
    expect(cumulativeCloseMonthsOrNull('2022-12')).toBeNull();
  });

  it('accepts only complete cumulative authority heads and the explicit empty JVM state', () => {
    const head = {
      contractVersion: 'cashflow-cumulative-close-v2',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      status: 'CLOSED',
      fromMonth: '2023-01',
      settlementMonth: '2026-08',
      closedThrough: '2026-07',
      rootHash: `sha256:${'a'.repeat(64)}`,
      revision: 1,
    };
    expect(readCashflowCumulativeCloseAuthority(head, {
      tenantId: 'tenant-a', projectId: 'project-a',
    })).toMatchObject({
      status: 'CLOSED', settlementMonth: '2026-08', closedThrough: '2026-07', revision: 1,
    });
    expect(readCashflowCumulativeCloseAuthority({ ...head, status: 'REOPEN_REQUESTED', revision: 2 }, {
      tenantId: 'tenant-a', projectId: 'project-a',
    })).toMatchObject({ status: 'REOPEN_REQUESTED', closedThrough: '2026-07', revision: 2 });
    expect(readCashflowCumulativeCloseAuthority({
      ...head, status: 'OPEN', closedThrough: '', rootHash: '', revision: 0,
    }, {
      tenantId: 'tenant-a', projectId: 'project-a', allowOpen: true,
    })).toEqual({ status: 'OPEN', closedThrough: null, rootHash: null, revision: 0 });
    expect(readCashflowCumulativeCloseAuthority({ ...head, rootHash: 'sha256:broken' }, {
      tenantId: 'tenant-a', projectId: 'project-a',
    })).toBeNull();
    expect(readCashflowCumulativeCloseAuthority({ ...head, closedThrough: '2022-12' }, {
      tenantId: 'tenant-a', projectId: 'project-a',
    })).toBeNull();
    expect(readCashflowCumulativeCloseAuthority({ ...head, status: 'closed' }, {
      tenantId: 'tenant-a', projectId: 'project-a',
    })).toBeNull();
    for (const settlementMonth of [undefined, '2026-8', '2026-09']) {
      expect(readCashflowCumulativeCloseAuthority({ ...head, settlementMonth }, {
        tenantId: 'tenant-a', projectId: 'project-a',
      })).toBeNull();
    }
  });

  it('keeps a January settlement in the new weekly year', () => {
    const authority = readCashflowCumulativeCloseAuthority({
      contractVersion: 'cashflow-cumulative-close-v2',
      tenantId: 'tenant-a',
      projectId: 'project-a',
      status: 'CLOSED',
      fromMonth: '2023-01',
      settlementMonth: '2026-01',
      closedThrough: '2025-12',
      rootHash: `sha256:${'a'.repeat(64)}`,
      revision: 1,
    }, { tenantId: 'tenant-a', projectId: 'project-a' });

    expect(authority).toMatchObject({ settlementMonth: '2026-01', closedThrough: '2025-12' });
  });
});
