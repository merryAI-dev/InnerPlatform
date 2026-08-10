// 누적 월 결산의 달력 규칙 (BFF 쪽 도메인).
//
// 누적 결산은 2023-01 을 기점으로 "선택한 회차 월의 직전 월"까지를 한 번에 덮는다.
// 이 모듈은 그 범위 계산만 안다 - HTTP 상태코드도, Firestore 도 모른다. 범위가
// 성립하지 않으면 null 을 돌려주고, 사용자에게 뭐라고 말할지는 라우트가 정한다.
//
// 회차 기한(회차 월의 10일)은 기한 규칙의 단일 소스인 cashflow-close-deadline 에서
// 파생한다. 회차 월의 10일 == "직전 월을 대상 월로 본 기한" 이며, JVM 의
// CashflowCloseDeadline.forCumulativeCycle 과 같은 표현이다.
import { cashflowMonthCloseDeadline } from './cashflow-close-deadline.mjs';

export const CASHFLOW_CUMULATIVE_CLOSE_CONTRACT = 'cashflow-cumulative-close-v2';
export const CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH = '2023-01';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function monthsBetween(startYearMonth, endYearMonth) {
  const result = [];
  let cursor = new Date(`${startYearMonth}-01T00:00:00Z`);
  const end = new Date(`${endYearMonth}-01T00:00:00Z`);
  while (cursor <= end && result.length < 240) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}

export function previousYearMonth(yearMonth) {
  const month = new Date(`${yearMonth}-01T00:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  return month.toISOString().slice(0, 7);
}

/** 회차 월이 덮는 누적 범위. 성립하지 않으면 null (2023-01 이전, 240개월 초과 등). */
export function cumulativeCloseMonthsOrNull(yearMonth) {
  const throughMonth = previousYearMonth(yearMonth);
  const months = monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, throughMonth);
  if (
    throughMonth < CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH
    || months.length === 0
    || months.at(-1) !== throughMonth
  ) {
    return null;
  }
  return months;
}

/**
 * 누적 결산 문서의 공통 범위 계약.
 * cycleYearMonth 는 결산 회차, throughMonth 는 실제로 잠그는 마지막 월이다.
 */
export function cashflowCumulativeCloseScope(cycleYearMonth, throughMonth = previousYearMonth(cycleYearMonth)) {
  const months = monthsBetween(CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH, throughMonth);
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(cycleYearMonth))
    || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(throughMonth))
    || throughMonth !== previousYearMonth(cycleYearMonth)
    || months.length === 0
    || months.at(-1) !== throughMonth) return null;
  return {
    contractVersion: CASHFLOW_CUMULATIVE_CLOSE_CONTRACT,
    fromMonth: CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH,
    cycleYearMonth,
    throughMonth,
    monthCount: months.length,
    weekCount: months.length * 5,
    cellCount: months.length * 160,
  };
}

/** 저장 문서의 새 scope와 레거시 top-level 필드를 동일한 계약으로 읽는다. */
export function readCashflowCumulativeCloseScope(record = {}) {
  const nested = record?.scope && typeof record.scope === 'object' ? record.scope : {};
  const explicitCycleYearMonth = text(nested.cycleYearMonth) || text(record.cycleYearMonth);
  const explicitThroughMonth = text(nested.throughMonth) || text(record.throughMonth);
  const cycleYearMonth = explicitCycleYearMonth || text(record.yearMonth);
  // Older requests stored `yearMonth` as the last covered month. Keep reading
  // those documents as-is; only the explicit v2 scope uses the previous-month
  // horizon.
  const legacy = !explicitCycleYearMonth && !explicitThroughMonth && !Object.hasOwn(record, 'scope');
  const throughMonth = explicitThroughMonth
    || (legacy ? cycleYearMonth : (cycleYearMonth ? previousYearMonth(cycleYearMonth) : ''));
  const fromMonth = text(nested.fromMonth) || text(record.fromMonth) || CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH;
  const contractVersion = text(nested.contractVersion) || text(record.contractVersion);
  const expected = cashflowCumulativeCloseScope(cycleYearMonth, throughMonth);
  const legacyRange = /^20\d{2}-(0[1-9]|1[0-2])$/.test(throughMonth)
    && fromMonth === CASHFLOW_CUMULATIVE_CLOSE_FROM_MONTH
    && monthsBetween(fromMonth, throughMonth).at(-1) === throughMonth;
  return {
    contractVersion,
    fromMonth,
    cycleYearMonth,
    throughMonth,
    monthCount: Number(nested.monthCount ?? record.monthCount),
    weekCount: Number(nested.weekCount ?? record.weekCount),
    cellCount: Number(nested.cellCount ?? record.cellCount),
    validRange: Boolean(expected && fromMonth === expected.fromMonth) || (legacy && legacyRange),
    strictRange: !legacy,
    legacy,
  };
}

export function cashflowCumulativeCloseCycle(yearMonth, businessDate) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(yearMonth))
    || !/^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/.test(String(businessDate))) return null;
  const targetYearMonth = previousYearMonth(yearMonth);
  return {
    cycleYearMonth: yearMonth,
    targetYearMonth,
    // 회차 월의 10일. 기한 규칙의 단일 소스에서 파생한다 - `${yearMonth}-10` 을
    // 여기서 또 쓰면 기한 규칙이 세 번째로 복제된다.
    deadline: cashflowMonthCloseDeadline(targetYearMonth),
    eligible: targetYearMonth < String(businessDate).slice(0, 7),
  };
}
