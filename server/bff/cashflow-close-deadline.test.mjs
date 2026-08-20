import { describe, expect, it } from 'vitest';
import {
  cashflowFinanceWeekDeadlineAt,
  cashflowWeeklyApproverDeadlineAt,
} from './cashflow-close-deadline.mjs';

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

// PARITY TABLE — JVM FirestoreInheritedWeeklyExpensePersistence.financeWeekDeadline 과 같은 표다.
// 규칙: 그 주의 목요일 자정(= 다음날 0시 KST). 목요일이 없는 부분 주는 주 마지막 날 다음날 0시.
// 2026-08-01 은 토요일이라 1주가 토·일 이틀뿐이고, 그 주에는 목요일이 없다.
const FINANCE_WEEK_PARITY = [
  ['2026-08', 1, '2026-08-02T15:00:00.000Z'],
  ['2026-08', 2, '2026-08-06T15:00:00.000Z'],
  ['2026-08', 3, '2026-08-13T15:00:00.000Z'],
  ['2026-08', 4, '2026-08-20T15:00:00.000Z'],
  ['2026-08', 5, '2026-08-27T15:00:00.000Z'],
  ['2026-02', 5, '2026-02-26T15:00:00.000Z'],
  ['2026-03', 1, '2026-03-01T15:00:00.000Z'],
  ['2026-01', 1, '2026-01-01T15:00:00.000Z'],
  // 2026-12-31 이 목요일이라 5주차 마감이 해를 넘긴다.
  ['2026-12', 5, '2026-12-31T15:00:00.000Z'],
];

describe('finance week deadline — JVM parity', () => {
  it.each(FINANCE_WEEK_PARITY)('%s %s주차 마감은 %s', (yearMonth, weekNo, expected) => {
    expect(cashflowFinanceWeekDeadlineAt(yearMonth, weekNo)).toBe(expected);
  });

  it.each([['2026-08', 0], ['2026-08', 6], ['2026-13', 1], ['', 1], [null, 2]])(
    'refuses to guess for %j %j',
    (yearMonth, weekNo) => {
      expect(cashflowFinanceWeekDeadlineAt(yearMonth, weekNo)).toBeNull();
    },
  );
});
