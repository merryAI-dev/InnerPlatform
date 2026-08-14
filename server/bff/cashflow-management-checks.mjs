// 월 결산 관리검사 4종 (BFF 쪽 도메인).
//
// 검사 "계산"은 BFF 가 소유하고, JVM 은 검사 ID 와 상태의 형태만 검증해 저장한다
// (CloseCashflowMonthRequest 의 @Pattern). 그래서 여기의 parity 대상은 계산이 아니라
// **ID 목록과 상태 어휘**다 - 한쪽이 검사를 추가/개명하면 JVM 의 패턴과 갈려 확정이
// 400 으로 거부된다. 그 일치는 cashflow-management-checks.test.mjs 와 JVM
// CloseCashflowMonthRequestTest 가 같은 리터럴 표로 고정한다.
//
// 이 모듈은 순수하다: HTTP 도 Firestore 도 모른다. 주차 데이터(weeks/cellStates)를
// canonical 소스에서 어떻게 만드는지는 라우트의 buildCashflowManagementChecks 가 안다.
import { readOptionalText } from './bff-utils.mjs';
import { stableStringify } from './utils.mjs';
import { safeAmount, sumSafe } from './cashflow-amounts.mjs';
import { CASHFLOW_IN_LINES, CASHFLOW_OUT_LINES } from './cashflow-policy.mjs';
import { cashflowRangeSortKey } from './cashflow-range.mjs';

export const CASHFLOW_MANAGEMENT_CHECK_IDS = [
  'labor-transfer',
  'profit-vat-after-deposit',
  'negative-projection-balance',
  'future-prepay-over-million',
];

export const CASHFLOW_MANAGEMENT_CHECK_STATUSES = ['OK', 'WARNING', 'REVIEW_REQUIRED'];

function managementCheck(id, status, title, detail, findings = []) {
  return findings.length > 0 ? { id, status, title, detail, findings } : { id, status, title, detail };
}

export function laborTransferCheck(weeks, cellStates, yearMonth) {
  const yearMonths = [...new Set([yearMonth, ...weeks.map((week) => readOptionalText(week.yearMonth))])].sort();
  const warnings = [];
  const reviews = [];
  for (const yearMonth of yearMonths) {
    const projection = cellStates.get(`${yearMonth}:projection:3:MYSC_LABOR_OUT`);
    if (!projection || projection.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 인건비 미입력`);
      continue;
    }
    const plannedAmount = safeAmount(projection.amount);
    if (plannedAmount === 0) {
      reviews.push(`${yearMonth} 3주차 인건비 미입력`);
      continue;
    }
    const actual = cellStates.get(`${yearMonth}:actual:3:MYSC_LABOR_OUT`);
    if (!actual || actual.cellState === 'EMPTY') {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · Actual 인건비 미기입`);
      continue;
    }
    const actualAmount = safeAmount(actual.amount);
    if (actualAmount === 0) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 0원 · 실제 미이관`);
    } else if (actualAmount < plannedAmount) {
      warnings.push(`${yearMonth} 3주차 · 예정 ${plannedAmount.toLocaleString('ko-KR')}원 · 실제 ${actualAmount.toLocaleString('ko-KR')}원 · 일부 이관`);
    }
  }
  const findings = warnings.length > 0 ? warnings : reviews;
  return managementCheck(
    'labor-transfer',
    warnings.length > 0 ? 'WARNING' : reviews.length > 0 ? 'REVIEW_REQUIRED' : 'OK',
    'MYSC 인건비 이관',
    findings.length > 0 ? findings.join(', ') : '기준일까지 모든 3주차 인건비 이관을 확인했습니다.',
    findings,
  );
}

export function profitVatAfterDepositCheck(weeks) {
  const due = [];
  const deposits = weeks.filter((week) => safeAmount(week.projection?.SALES_IN) > 0);
  for (const deposit of deposits) {
    const index = weeks.indexOf(deposit);
    const next = weeks[index + 1];
    const gapMs = next?.weekStart && deposit.weekEnd
      ? Date.parse(`${next.weekStart}T00:00:00Z`) - Date.parse(`${deposit.weekEnd}T00:00:00Z`)
      : Number.POSITIVE_INFINITY;
    const targets = [deposit, gapMs <= 8 * 86_400_000 ? next : null].filter(Boolean);
    const hasProfit = targets.some((week) => safeAmount(week.projection?.MYSC_PROFIT_OUT) > 0);
    const hasVat = targets.some((week) => safeAmount(week.projection?.SALES_VAT_OUT) > 0);
    const missing = [hasProfit ? null : 'MYSC 수익', hasVat ? null : '매출부가세'].filter(Boolean);
    if (missing.length > 0) {
      due.push(`${deposit.yearMonth} ${deposit.weekNo}주차에 매출입금이 있으나 [${missing.join('·')}] 계획이 Projection에 없습니다.`);
    }
  }
  if (deposits.length === 0) {
    return managementCheck('profit-vat-after-deposit', 'REVIEW_REQUIRED', '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)', 'Projection 매출입금이 없습니다. 해당 없음 여부를 사람이 확인해 주세요.');
  }
  return managementCheck(
    'profit-vat-after-deposit',
    due.length > 0 ? 'WARNING' : 'OK',
    '입금 후 MYSC 수익·매출부가세 이관(해당 주, 차주)',
    due.length > 0 ? `입금 주차 또는 다음 주차까지 미이관: ${due.join(', ')}` : 'Projection 매출입금의 같은 주차 또는 다음 주차 이관을 확인했습니다.',
    due,
  );
}

export function negativeProjectionCheck(weeks, openingBalance = 0) {
  let balance = safeAmount(openingBalance);
  let prepay = 0;
  const findings = [];
  if (balance === null) {
    return managementCheck(
      'negative-projection-balance',
      'REVIEW_REQUIRED',
      'Projection 잔액 마이너스',
      'Projection 이월 잔액을 확인할 수 없어 잔액을 판정할 수 없습니다.',
      ['Projection 이월 잔액 확인 필요'],
    );
  }
  for (const week of weeks) {
    const projection = week.projection && typeof week.projection === 'object' ? week.projection : {};
    const totalIn = sumSafe(CASHFLOW_IN_LINES.map((lineId) => (
      Object.hasOwn(projection, lineId) ? projection[lineId] : 0
    )));
    const totalOut = sumSafe(CASHFLOW_OUT_LINES.map((lineId) => (
      Object.hasOwn(projection, lineId) ? projection[lineId] : 0
    )));
    const prepayAmount = Object.hasOwn(projection, 'MYSC_PREPAY_IN')
      ? safeAmount(projection.MYSC_PREPAY_IN)
      : 0;
    if (totalIn === null || totalOut === null || prepayAmount === null) {
      return managementCheck(
        'negative-projection-balance',
        'REVIEW_REQUIRED',
        'Projection 잔액 마이너스',
        'Projection 금액 중 확인할 수 없는 값이 있어 잔액을 판정할 수 없습니다.',
        ['Projection 금액 확인 필요'],
      );
    }
    balance += totalIn - totalOut;
    prepay += prepayAmount;
    if (balance < 0) {
      findings.push(`${week.yearMonth} ${week.weekNo}주차 · 잔액 ${balance.toLocaleString('ko-KR')}원${prepay > 0 ? '' : ' · MYSC 선입금 Projection 없음'}`);
    }
  }
  if (findings.length > 0) {
    return managementCheck(
      'negative-projection-balance',
      'WARNING',
      'Projection 잔액 마이너스',
      `${findings.length}개 주차에서 마이너스 · 최초 ${findings[0]}`,
      findings,
    );
  }
  return managementCheck('negative-projection-balance', 'OK', 'Projection 잔액 마이너스', 'Projection 누적 잔액이 0원 이상입니다.');
}

export function futurePrepayCheck(weeks, asOfKey) {
  const occurrences = weeks.filter((week) => (
    cashflowRangeSortKey(week) > asOfKey && safeAmount(week.projection?.MYSC_PREPAY_IN) > 1_000_000
  ));
  return managementCheck(
    'future-prepay-over-million',
    occurrences.length > 0 ? 'WARNING' : 'OK',
    '금주 이후 선입금 요청 100만원 초과',
    occurrences.length > 0
      ? occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`).join(', ')
      : '금주 이후 100만원 초과 요청이 없습니다.',
    occurrences.map((week) => `${week.yearMonth} ${week.weekNo}주차 · ${safeAmount(week.projection?.MYSC_PREPAY_IN).toLocaleString('ko-KR')}원`),
  );
}

export function validManagementConfirmations(confirmations) {
  const byId = new Map();
  for (const item of Array.isArray(confirmations) ? confirmations : []) {
    const checkId = readOptionalText(item?.checkId);
    const decision = readOptionalText(item?.decision).toUpperCase();
    if (!CASHFLOW_MANAGEMENT_CHECK_IDS.includes(checkId) || !['CONFIRMED', 'NOT_APPLICABLE'].includes(decision)) continue;
    byId.set(checkId, { checkId, decision });
  }
  return byId;
}

export function matchingManagementChecks(expected, actual) {
  const select = (items) => (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: readOptionalText(item?.id),
      status: readOptionalText(item?.status),
      title: readOptionalText(item?.title),
      detail: readOptionalText(item?.detail),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return select(expected).length === CASHFLOW_MANAGEMENT_CHECK_IDS.length
    && stableStringify(select(expected)) === stableStringify(select(actual));
}
