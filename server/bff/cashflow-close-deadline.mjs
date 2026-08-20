// 월 결산 기한 규칙의 단일 소스.
//
// 판정 주체는 JVM 이다. 다만 대시보드는 선택한 달 하나가 아니라 모든 달을 한 번에
// 그려야 해서 BFF 에도 같은 규칙이 필요하다. 그 "같은 규칙" 을 두 런타임이 각자
// 구현하면 조용히 갈린다 - SPEC-16 의 revision 해시가 JVM a400f3… / BFF ea20de… 로
// 갈렸던 것이 같은 종류다.
//
// 그래서 규칙을 이 모듈 하나에 두고, JVM CashflowCloseDeadline 과 같은 표를
// 양쪽 테스트에 둔다. 한쪽을 고치면 다른 쪽 표가 깨지도록 한 것이다.
//
// 규칙: 대상 월의 다음 달 10일. (JVM YearMonth.parse(ym).plusMonths(1).atDay(10))

const YEAR_MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const BUSINESS_DATE_RE = /^20\d{2}-(0[1-9]|1[0-2])-\d{2}$/;

export function isCashflowYearMonth(value) {
  return YEAR_MONTH_RE.test(String(value ?? ''));
}

export function cashflowMonthCloseDeadline(yearMonth) {
  const match = YEAR_MONTH_RE.exec(String(yearMonth ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const deadlineYear = month === 12 ? year + 1 : year;
  const deadlineMonth = month === 12 ? 1 : month + 1;
  return `${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-10`;
}

// 월 결산 마감의 시각 표현. 날짜 규칙(위)은 JVM CashflowCloseDeadline 과 패리티 쌍이고,
// 여기서는 그 날짜를 진행 바가 쓰는 시각으로 옮긴다. 10일이 마지막 유효일이므로 11일 0시 KST.
// 조직장 승인은 그로부터 3일(14일 0시) - JVM ApproverDeadlineCalculator.monthly 와 같은 값이며
// 양쪽 테스트에 같은 표를 둔다. (주간 마감은 JVM 이 응답에 실어 보내므로 사본이 없다.)
const KST_MIDNIGHT_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const MONTH_APPROVAL_DAYS = 3;

function kstMidnightAfter(dateText, extraDays = 0) {
  if (!BUSINESS_DATE_RE.test(String(dateText ?? ''))) return null;
  const at = Date.parse(`${dateText}T00:00:00Z`);
  if (!Number.isFinite(at)) return null;
  return new Date(at + (1 + extraDays) * DAY_MS - KST_MIDNIGHT_OFFSET_MS).toISOString();
}

export function cashflowMonthCloseDeadlineAt(yearMonth) {
  return kstMidnightAfter(cashflowMonthCloseDeadline(yearMonth));
}

export function cashflowMonthCloseApproverDeadlineAt(yearMonth) {
  return kstMidnightAfter(cashflowMonthCloseDeadline(yearMonth), MONTH_APPROVAL_DAYS);
}

// 기한 초과 여부. 기준일을 모르면 단정하지 않는다 - 판정 불능과 "초과 아님" 은 다르다.
export function isCashflowCloseOverdue({ yearMonth, status, businessDate }) {
  if (!BUSINESS_DATE_RE.test(String(businessDate ?? ''))) return false;
  if (String(status ?? '').toUpperCase() === 'CLOSED') return false;
  const deadline = cashflowMonthCloseDeadline(yearMonth);
  return Boolean(deadline) && String(businessDate) > deadline;
}
