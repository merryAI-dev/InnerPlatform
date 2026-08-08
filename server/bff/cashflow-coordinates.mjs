import cashflowPolicyData from '../../policies/cashflow-policy.json' with { type: 'json' };

// 전사 고정 양식의 좌표 계약. 이 파일이 유일한 진실이다.
//
// 원칙 (흔들지 않는다):
//   1. 주별 블록은 E:BL 60칸 하나뿐이고, 그 연도는 프로젝트당 단일 상수다.
//   2. 연간 열은 C:D(이전 2개)와 BM:BR(이후 6개) 고정이다.
//   3. 라인 정체성은 행 인덱스다. 라벨 문자열로 라인을 찾지 않는다.
//   4. 좌표 밖의 데이터는 존재하지 않는 것으로 취급한다.
//   5. 양식이 다르면 적응하지 않고 거부한다.
//
// 근거: docs/architecture/contracts/2026-07-28-cashflow-formula-validation-contract.md
//   "2024 annual -> 2025 annual -> 2026 week 1..60 -> 2027 annual -> ... -> 2032 annual"

export const SHEET_RANGE = 'A1:BT60';

export const WEEKS_PER_MONTH = 5;
export const MONTHS_PER_YEAR = 12;
export const WEEKS_PER_YEAR = WEEKS_PER_MONTH * MONTHS_PER_YEAR;

// 주별 블록: E:BL (열 인덱스 4..63)
export const WEEK_FIRST_COLUMN = 4;

// 연간 열: C:D 는 주별 연도 이전, BM:BR 은 이후.
export const ANNUAL_COLUMNS_BEFORE = Object.freeze([2, 3]);
export const ANNUAL_COLUMNS_AFTER = Object.freeze([64, 65, 66, 67, 68, 69]);
export const SOURCE_YEAR_TOTAL_COLUMN = 70;

// 라인 = 행. 배열 순서가 정책 lineEntries 순서와 1:1 대응한다.
export const LINE_ROWS = Object.freeze({
  projection: Object.freeze([14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]),
  actual: Object.freeze([37, 38, 39, 40, 41, 42, 43, 45, 46, 47, 48, 49, 50, 51, 52, 53]),
});

export const LINE_IDS = Object.freeze(cashflowPolicyData.lineEntries.map((entry) => entry.lineId));

const YEAR_MONTH_RE = /^(20\d{2})-(0[1-9]|1[0-2])$/;

export class CashflowTemplateMismatchError extends Error {
  constructor(detail) {
    super('양식이 다릅니다.');
    this.name = 'CashflowTemplateMismatchError';
    this.code = 'cashflow_sheet_template_mismatch';
    this.detail = detail;
  }
}

export function requireWeeklyYear(value) {
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 2000 || year > 2099) {
    throw new CashflowTemplateMismatchError(`주별 연도가 좌표 계약을 벗어났습니다: ${value}`);
  }
  return year;
}

// 주별 블록 이전 2개 연도, 이후 6개 연도. 좌표가 개수를 결정한다.
export function annualYearsFor(weeklyYear) {
  const year = requireWeeklyYear(weeklyYear);
  return Object.freeze([
    ...ANNUAL_COLUMNS_BEFORE.map((_, offset) => year - ANNUAL_COLUMNS_BEFORE.length + offset),
    ...ANNUAL_COLUMNS_AFTER.map((_, offset) => year + 1 + offset),
  ]);
}

export function isWeeklyMonth(weeklyYear, yearMonth) {
  const match = YEAR_MONTH_RE.exec(String(yearMonth ?? ''));
  return Boolean(match) && Number(match[1]) === requireWeeklyYear(weeklyYear);
}

// 좌표 밖(연 단위 관리 연도, 범위 밖 주차)은 -1. 낙오 문서는 여기서 걸러진다.
export function weekOrdinal(weeklyYear, yearMonth, weekNo) {
  if (!isWeeklyMonth(weeklyYear, yearMonth)) return -1;
  const week = Number(weekNo);
  if (!Number.isInteger(week) || week < 1 || week > WEEKS_PER_MONTH) return -1;
  const month = Number(String(yearMonth).slice(5, 7));
  return (month - 1) * WEEKS_PER_MONTH + (week - 1);
}

export function weekColumnFor(weeklyYear, yearMonth, weekNo) {
  const ordinal = weekOrdinal(weeklyYear, yearMonth, weekNo);
  return ordinal === -1 ? -1 : WEEK_FIRST_COLUMN + ordinal;
}

export function annualColumnFor(weeklyYear, year) {
  const index = annualYearsFor(weeklyYear).indexOf(Number(year));
  if (index === -1) return -1;
  return index < ANNUAL_COLUMNS_BEFORE.length
    ? ANNUAL_COLUMNS_BEFORE[index]
    : ANNUAL_COLUMNS_AFTER[index - ANNUAL_COLUMNS_BEFORE.length];
}

export function lineRowFor(mode, lineIndex) {
  const rows = LINE_ROWS[mode];
  if (!rows) throw new CashflowTemplateMismatchError(`알 수 없는 모드입니다: ${mode}`);
  const row = rows[Number(lineIndex)];
  if (row === undefined) throw new CashflowTemplateMismatchError(`라인 인덱스가 범위를 벗어났습니다: ${lineIndex}`);
  return row;
}

export function lineIndexOfRow(mode, rowIndex) {
  const rows = LINE_ROWS[mode];
  if (!rows) throw new CashflowTemplateMismatchError(`알 수 없는 모드입니다: ${mode}`);
  return rows.indexOf(Number(rowIndex));
}
