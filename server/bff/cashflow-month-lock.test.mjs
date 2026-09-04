import { describe, expect, it } from 'vitest';
import {
  cashflowCumulativeMonthLocked,
  readCashflowCumulativeCloseAuthority,
} from './cashflow-close-calendar.mjs';

// PARITY TABLE — JVM CashflowMonthLockTest 와 같은 표다.
// 한쪽 규칙을 고치면 다른 쪽 표가 깨지도록 의도적으로 중복해 둔 것이므로,
// 값이 달라져야 한다면 반드시 두 파일을 함께 고쳐라.
//
// 규칙은 2026-08-14 기간 권한 계약이 정한 것이다:
//   잠금 기준은 head 의 closedThrough 하나이며, monthly_closes 는 실행 이력이다.
//   closedThrough 연도보다 앞선 연간형 2024·2025는 월별 CLOSED 로 해석하지 않는다.
const authorityOf = (closedThrough, settlementMonth) => readCashflowCumulativeCloseAuthority({
  contractVersion: 'cashflow-cumulative-close-v2',
  tenantId: 'mysc',
  projectId: 'p-1',
  status: 'CLOSED',
  fromMonth: '2023-01',
  closedThrough,
  settlementMonth,
  rootHash: `sha256:${'a'.repeat(64)}`,
  revision: 1,
}, { tenantId: 'mysc', projectId: 'p-1' });

// closedThrough, settlementMonth(회차), 대상 월, 잠김 여부
const LOCK_PARITY = [
  // 라이브 AXR·JLIN: 8월 회차는 7월까지만 덮는다. 8월은 열려 있다.
  ['2026-07', '2026-08', '2026-08', false],
  ['2026-07', '2026-08', '2026-07', true],
  ['2026-07', '2026-08', '2026-01', true],
  // closedThrough 연도 밖 - 연간형으로만 존재하는 기간은 잠그지 않는다.
  ['2026-07', '2026-08', '2025-12', false],
  ['2026-07', '2026-08', '2024-06', false],
  // 라이브 2026전남글로벌: 7월 회차는 6월까지.
  ['2026-06', '2026-07', '2026-07', false],
  ['2026-06', '2026-07', '2026-06', true],
  // 연초 회차도 직전 월까지 같은 누적 월 결산으로 잠근다.
  ['2026-12', '2027-01', '2026-12', true],
];

describe('cumulative month lock — JVM parity', () => {
  it.each(LOCK_PARITY)(
    'closedThrough=%s 회차=%s 일 때 %s 는 잠김=%s',
    (closedThrough, settlementMonth, yearMonth, expected) => {
      expect(cashflowCumulativeMonthLocked(authorityOf(closedThrough, settlementMonth), yearMonth))
        .toBe(expected);
    },
  );
});

describe('사보타주 — 계약을 어기면 여기서 깨진다', () => {
  // monthly_closes 를 권한 판정에 되살리면 8월이 잠긴다. 계약 위반이며 라이브 증상이었다.
  it('회차 월 자체는 절대 잠기지 않는다', () => {
    const authority = authorityOf('2026-07', '2026-08');
    expect(cashflowCumulativeMonthLocked(authority, '2026-08')).toBe(false);
  });

  // 연도 제한을 빼면 2023-01 부터 전부 잠긴다. 계약이 금지한 해석이다.
  it('closedThrough 연도 밖은 그보다 이전이어도 잠기지 않는다', () => {
    const authority = authorityOf('2026-07', '2026-08');
    for (const yearMonth of ['2023-01', '2024-06', '2025-12']) {
      expect(cashflowCumulativeMonthLocked(authority, yearMonth)).toBe(false);
    }
  });

  // 권한을 확인할 수 없으면 잠그지 않는다 - 판정 불능과 "잠김" 은 다르다.
  it.each([null, undefined, {}])('authority 가 %j 면 잠그지 않는다', (authority) => {
    expect(cashflowCumulativeMonthLocked(authority, '2026-07')).toBe(false);
  });

  it.each(['', 'not-a-month', '2026-13', '2026-00', null, undefined])(
    '대상 월 %j 는 추측하지 않고 잠그지 않는다',
    (yearMonth) => {
      expect(cashflowCumulativeMonthLocked(authorityOf('2026-07', '2026-08'), yearMonth)).toBe(false);
    },
  );
});
