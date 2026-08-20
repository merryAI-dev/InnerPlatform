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

// --- 조직장 승인 마감 (2026-08-20 보람) ---
// 표시 전용 규칙이다. 쓰기를 막지도, 미준수를 누적하지도 않는다(미준수는 실무자 마감 기준뿐).
// 그래서 판정 주체(JVM) 짝 없이 BFF 에만 둔다 - 이 마감이 쓰기를 막게 되는 날 JVM 으로 옮긴다.
// Asia/Seoul 은 DST 가 없어 KST 0시 = UTC 전날 15시 고정이다.
const KST_OFFSET_MS = 9 * 3_600_000;
// 주정산: 실무자 마감(그 주 목요일 자정 = 금 0시 KST, 목요일이 없는 부분 주는 주 마지막 날
// 다음날 0시 - JVM financeWeekDeadline) + 13시간 = 같은 날 13:00 KST.
const WEEKLY_APPROVER_OFFSET_MS = 13 * 3_600_000;

export function cashflowWeeklyApproverDeadlineAt(practitionerDeadlineAt) {
  const at = Date.parse(String(practitionerDeadlineAt ?? ''));
  return Number.isFinite(at) ? new Date(at + WEEKLY_APPROVER_OFFSET_MS).toISOString() : null;
}

function kstMidnightInstant(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS).toISOString();
}

function nextMonthOf(yearMonth) {
  const match = YEAR_MONTH_RE.exec(String(yearMonth ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

// 월결산 실무자 마감의 시각 표현: 익월 10일 자정 = 11일 0시 KST.
// (cashflowMonthCloseDeadline 의 날짜 규칙과 같은 표 - 10일이 마지막 유효일)
export function cashflowMonthCloseDeadlineAt(yearMonth) {
  const next = nextMonthOf(yearMonth);
  return next ? kstMidnightInstant(next[0], next[1], 11) : null;
}

// 월결산 조직장 승인 마감: 달력 고정 익월 14일 0시 KST. 실무자가 늦게 요청하면
// 조직장 시간이 3일보다 짧아진다 - 요청+3일이 아니라 달력 고정(2026-08-20 결정).
export function cashflowMonthCloseApproverDeadlineAt(yearMonth) {
  const next = nextMonthOf(yearMonth);
  return next ? kstMidnightInstant(next[0], next[1], 14) : null;
}

// 기한 초과 여부. 기준일을 모르면 단정하지 않는다 - 판정 불능과 "초과 아님" 은 다르다.
export function isCashflowCloseOverdue({ yearMonth, status, businessDate }) {
  if (!BUSINESS_DATE_RE.test(String(businessDate ?? ''))) return false;
  if (String(status ?? '').toUpperCase() === 'CLOSED') return false;
  const deadline = cashflowMonthCloseDeadline(yearMonth);
  return Boolean(deadline) && String(businessDate) > deadline;
}
