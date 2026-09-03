import { describe, expect, it } from 'vitest';
import { cashflowWeeklyApproverDeadlineAt } from './cashflow-close-deadline.mjs';

describe('weekly approver deadlines — display only, KST', () => {
  it('weekly approver deadline is the practitioner deadline + 13 hours', () => {
    // 실무자 마감 금 0시 KST = 목 15:00Z → 승인 마감 금 13:00 KST = 금 04:00Z
    expect(cashflowWeeklyApproverDeadlineAt('2026-08-20T15:00:00Z')).toBe('2026-08-21T04:00:00.000Z');
    // 목요일이 없는 부분 주의 대체 마감에도 같은 +13시간이 따라간다.
    expect(cashflowWeeklyApproverDeadlineAt('2026-08-31T15:00:00.000Z')).toBe('2026-09-01T04:00:00.000Z');
    expect(cashflowWeeklyApproverDeadlineAt('')).toBeNull();
    expect(cashflowWeeklyApproverDeadlineAt(undefined)).toBeNull();
  });
});
