// 주간 표시 deadline 보조 함수. 월간 deadline은 JVM monthCloseCalendar 계약에서만 온다.

const YEAR_MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;

// Asia/Seoul 은 DST 가 없어 KST 0시 = UTC 전날 15시 고정이다.
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
// 주정산: 실무자 마감(그 주 목요일 자정 = 금 0시 KST, 목요일이 없는 부분 주는 주 마지막 날
// 다음날 0시 - JVM financeWeekDeadline) + 13시간 = 같은 날 13:00 KST.
const WEEKLY_APPROVER_OFFSET_MS = 13 * 3_600_000;

export function cashflowWeeklyApproverDeadlineAt(practitionerDeadlineAt) {
  const at = Date.parse(String(practitionerDeadlineAt ?? ''));
  return Number.isFinite(at) ? new Date(at + WEEKLY_APPROVER_OFFSET_MS).toISOString() : null;
}

// 주정산 실무자 마감. 판정 주체는 JVM financeWeekDeadline 이고 이것은 그 표의 사본이다 -
// 대시보드가 모든 주를 한 번에 그려야 해서 BFF 에도 같은 규칙이 필요하다(이 파일의 존재 이유).
// 규칙: 그 주(월~일) 안의 목요일 자정 = 목요일 다음날 0시 KST. 목요일이 없는 부분 주(1주·5주)는
// 그 주 마지막 날 다음날 0시. 양쪽 테스트에 같은 표를 둔다.
const FINANCE_WEEK_COUNT = 5;

function utcDay(year, month, day) {
  return Date.UTC(year, month - 1, day);
}

export function cashflowFinanceWeekDeadlineAt(yearMonth, weekNo) {
  const match = YEAR_MONTH_RE.exec(String(yearMonth ?? ''));
  const week = Number(weekNo);
  if (!match || !Number.isInteger(week) || week < 1 || week > FINANCE_WEEK_COUNT) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const first = utcDay(year, month, 1);
  // getUTCDay: 일=0 → JVM DayOfWeek(월=1..일=7) 와 맞추면 월요일까지 되감는 일수는 (dow+6)%7.
  const firstMonday = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = utcDay(year, month, lastDayOfMonth);
  const start = week === 1 ? first : firstMonday + (week - 1) * 7 * DAY_MS;
  const end = week === FINANCE_WEEK_COUNT ? monthEnd : firstMonday + week * 7 * DAY_MS - DAY_MS;
  let thursday = start;
  while (thursday <= end && new Date(thursday).getUTCDay() !== 4) thursday += DAY_MS;
  const deadlineDay = thursday > end ? end + DAY_MS : thursday + DAY_MS;
  return new Date(deadlineDay - KST_OFFSET_MS).toISOString();
}
