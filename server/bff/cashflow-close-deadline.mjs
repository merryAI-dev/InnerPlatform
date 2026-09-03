// 주간 표시 deadline 보조 함수. 월간 deadline은 JVM monthCloseCalendar 계약에서만 온다.

// 주정산: 실무자 마감(그 주 목요일 자정 = 금 0시 KST, 목요일이 없는 부분 주는 주 마지막 날
// 다음날 0시 - JVM financeWeekDeadline) + 13시간 = 같은 날 13:00 KST.
const WEEKLY_APPROVER_OFFSET_MS = 13 * 3_600_000;

export function cashflowWeeklyApproverDeadlineAt(practitionerDeadlineAt) {
  const at = Date.parse(String(practitionerDeadlineAt ?? ''));
  return Number.isFinite(at) ? new Date(at + WEEKLY_APPROVER_OFFSET_MS).toISOString() : null;
}
