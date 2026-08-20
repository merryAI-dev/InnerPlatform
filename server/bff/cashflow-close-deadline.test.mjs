import { describe, expect, it } from 'vitest';
import {
  cashflowMonthCloseApproverDeadlineAt,
  cashflowMonthCloseDeadline,
  cashflowMonthCloseDeadlineAt,
  isCashflowCloseOverdue,
} from './cashflow-close-deadline.mjs';

// PARITY TABLE — JVM CashflowCloseDeadlineTest 와 같은 표다.
// 한쪽 규칙을 고치면 다른 쪽 표가 깨지도록 의도적으로 중복해 둔 것이므로,
// 값이 달라져야 한다면 반드시 두 파일을 함께 고쳐라.
const DEADLINE_PARITY = [
  ['2026-01', '2026-02-10'],
  ['2026-07', '2026-08-10'],
  ['2026-09', '2026-10-10'],
  ['2026-11', '2026-12-10'],
  ['2026-12', '2027-01-10'],
  ['2027-12', '2028-01-10'],
  ['2024-02', '2024-03-10'],
];

describe('cashflow close deadline — JVM parity', () => {
  it.each(DEADLINE_PARITY)('%s 의 기한은 %s', (yearMonth, expected) => {
    expect(cashflowMonthCloseDeadline(yearMonth)).toBe(expected);
  });

  it.each(['not-a-month', '', '2026-13', '2026-00', '1999-05', null, undefined])(
    'rejects %j instead of guessing a deadline',
    (value) => {
      expect(cashflowMonthCloseDeadline(value)).toBeNull();
    },
  );
});

describe('close overdue', () => {
  it('is overdue only after the deadline day', () => {
    const base = { yearMonth: '2026-07', status: 'OPEN' };
    expect(isCashflowCloseOverdue({ ...base, businessDate: '2026-08-09' })).toBe(false);
    expect(isCashflowCloseOverdue({ ...base, businessDate: '2026-08-10' })).toBe(false);
    expect(isCashflowCloseOverdue({ ...base, businessDate: '2026-08-11' })).toBe(true);
  });

  it('never marks a closed month overdue', () => {
    expect(isCashflowCloseOverdue({ yearMonth: '2026-07', status: 'CLOSED', businessDate: '2026-12-31' })).toBe(false);
    expect(isCashflowCloseOverdue({ yearMonth: '2026-07', status: 'closed', businessDate: '2026-12-31' })).toBe(false);
  });

  // 기준일을 모르는 것과 "초과 아님" 은 다르다 — 단정하지 않는다.
  it.each(['', 'not-a-date', undefined])('does not assert overdue without a business date (%j)', (businessDate) => {
    expect(isCashflowCloseOverdue({ yearMonth: '2026-07', status: 'OPEN', businessDate })).toBe(false);
  });
});

// PARITY TABLE — JVM ApproverDeadlineCalculatorTest 와 같은 표다. 월 결산 조직장 승인 마감은
// 실무자 마감(10일) 다음 날 0시에서 3일 뒤, 즉 익월 14일 0시 KST.
// 주간 마감은 JVM 이 응답에 실어 보내므로 여기에 사본이 없다.
describe('month close deadline instants — JVM parity', () => {
  it('practitioner instant is the 11th 00:00 KST', () => {
    expect(cashflowMonthCloseDeadlineAt('2026-08')).toBe('2026-09-10T15:00:00.000Z');
    expect(cashflowMonthCloseDeadlineAt('2026-12')).toBe('2027-01-10T15:00:00.000Z');
    expect(cashflowMonthCloseDeadlineAt('nope')).toBeNull();
  });

  it.each([
    ['2026-08', '2026-09-13T15:00:00.000Z'],
    ['2026-12', '2027-01-13T15:00:00.000Z'],
    ['2024-02', '2024-03-13T15:00:00.000Z'],
  ])('%s 의 조직장 승인 마감은 %s', (yearMonth, expected) => {
    expect(cashflowMonthCloseApproverDeadlineAt(yearMonth)).toBe(expected);
  });

  it('does not guess for an invalid month', () => {
    expect(cashflowMonthCloseApproverDeadlineAt('2026-13')).toBeNull();
    expect(cashflowMonthCloseApproverDeadlineAt(null)).toBeNull();
  });
});
