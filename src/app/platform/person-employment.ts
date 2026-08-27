/**
 * 인력 명부의 고용(계약) 도메인 — 순수 함수만 둔다.
 *
 * 저장되는 진실은 `employments` 배열 하나다. 현재 근로형태·재직상태·퇴사일은
 * 전부 여기서 파생시킨다. 파생값을 문서에 같이 저장하면 둘이 조용히 갈라지고,
 * 그때 어느 쪽이 맞는지 아무도 모른다.
 *
 * 이 모듈은 다른 계층(스토어·화면·BFF)에 의존하지 않는다.
 */

export type EmploymentType = 'FULL_TIME' | 'INTERN' | 'PARTNER' | 'PLACEHOLDER';

/** 한 계약 구간 안에서의 상태. 계약이 끝났는지는 endDate 가 말한다. */
export type EmploymentState = 'WORKING' | 'ON_LEAVE' | 'PARENTAL_LEAVE';

export interface PersonEmployment {
  id: string;
  type: EmploymentType;
  state: EmploymentState;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, null 이면 진행 중 */
  endDate: string | null;
  note: string;
}

export interface Person {
  personId: string;
  name: string;
  nickname: string;
  email: string;
  departmentTop: string;
  departmentMid: string;
  departmentSub: string;
  title: string;
  grade: string;
  /** 생년월일 (YYYY-MM-DD). 만 나이는 저장하지 않고 조회 시 계산한다. */
  birthDate: string;
  workLocation: string;
  /** 최초 입사일 — 근속 계산의 기준 */
  joinedAt: string | null;
  employments: PersonEmployment[];
  uid: string | null;
  note?: string;
}

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  FULL_TIME: '정규직',
  INTERN: '인턴',
  PARTNER: '파트너·외부',
  PLACEHOLDER: '미채용(자리)',
};

export const EMPLOYMENT_STATE_LABELS: Record<EmploymentState, string> = {
  WORKING: '재직',
  ON_LEAVE: '휴직',
  PARENTAL_LEAVE: '육아휴직',
};

export const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[];
export const EMPLOYMENT_STATES = Object.keys(EMPLOYMENT_STATE_LABELS) as EmploymentState[];

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value);
}

export function isIsoMonth(value: unknown): value is string {
  return typeof value === 'string' && ISO_MONTH.test(value);
}

/** YYYY-MM 을 그 달의 1일로. 배정 기간과 고용 구간을 같은 축에서 비교하기 위한 변환. */
export function monthStart(yearMonth: string): string {
  return `${yearMonth}-01`;
}

/** YYYY-MM 을 그 달의 마지막 날로. */
export function monthEnd(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, '0')}`;
}

export function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** 구간이 날짜를 포함하는지. endDate 가 null 이면 열린 구간. */
export function coversDate(employment: PersonEmployment, isoDate: string): boolean {
  if (employment.startDate > isoDate) return false;
  return employment.endDate === null || employment.endDate >= isoDate;
}

/** 두 구간이 하루라도 겹치는지. */
export function overlaps(a: PersonEmployment, b: PersonEmployment): boolean {
  const aEnd = a.endDate ?? '9999-12-31';
  const bEnd = b.endDate ?? '9999-12-31';
  return a.startDate <= bEnd && b.startDate <= aEnd;
}

function sortByStart(employments: PersonEmployment[]): PersonEmployment[] {
  return [...employments].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function resolveEmploymentAt(person: Person, isoDate: string): PersonEmployment | null {
  const matches = (person.employments || []).filter((item) => coversDate(item, isoDate));
  if (matches.length === 0) return null;
  // 겹치는 구간이 있으면 늦게 시작한 쪽을 현재로 본다 — 전환 당일의 애매함을 한 방향으로 고정.
  return sortByStart(matches).at(-1) || null;
}

export function resolveCurrentEmployment(person: Person, today: string): PersonEmployment | null {
  return resolveEmploymentAt(person, today);
}

/** 마지막으로 끝난 계약의 종료일. 열린 계약이 하나라도 있으면 null. */
export function resolveSeparationDate(person: Person): string | null {
  const employments = person.employments || [];
  if (employments.length === 0) return null;
  if (employments.some((item) => item.endDate === null)) return null;
  return employments
    .map((item) => item.endDate as string)
    .sort()
    .at(-1) || null;
}

export interface Tenure {
  months: number;
  years: number;
  label: string;
}

/**
 * 만 나이. 근속과 같은 이유로 저장하지 않는다 — 생년월일만 있으면 언제 기준으로든
 * 다시 계산되고, 해가 바뀌어도 화면이 저절로 맞다.
 */
export function deriveAge(birthDate: string | null | undefined, asOf: string): number | null {
  const birth = String(birthDate || '').slice(0, 10);
  if (!isIsoDate(birth) || !isIsoDate(asOf) || birth > asOf) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ay, am, ad] = asOf.split('-').map(Number);
  const beforeBirthday = am < bm || (am === bm && ad < bd);
  return Math.max(0, ay - by - (beforeBirthday ? 1 : 0));
}

/**
 * 학위 취득 후 몇 해가 지났는지.
 *
 * KOICA 제안서는 '학위 취득일로부터 몇 년 경력' 을 본다. 학위취득년도(졸업증에 찍힌 해)만
 * 있으면 언제 기준으로든 다시 계산되므로 만 나이·근속과 같은 방식으로 저장하지 않는다.
 * 해 단위로만 적힌 값이라 연 단위로 센다.
 */
export function deriveYearsSinceDegree(degreeYear: string | null | undefined, asOf: string): number | null {
  const year = Number(String(degreeYear || '').trim());
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  const asOfYear = Number(String(asOf || '').slice(0, 4));
  if (!Number.isInteger(asOfYear) || asOfYear < year) return null;
  return asOfYear - year;
}

/** 근속. joinedAt 만 있으면 언제 기준으로든 다시 계산된다 — 저장값이 낡아도 화면은 정확하다. */
export function deriveTenure(joinedAt: string | null, asOf: string): Tenure | null {
  if (!isIsoDate(joinedAt) || !isIsoDate(asOf) || joinedAt > asOf) return null;
  const [jy, jm, jd] = joinedAt.split('-').map(Number);
  const [ay, am, ad] = asOf.split('-').map(Number);
  const months = Math.max(0, (ay - jy) * 12 + (am - jm) - (ad < jd ? 1 : 0));
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return {
    months,
    years: Math.round((months / 12) * 10) / 10,
    label: years > 0 ? `${years}년 ${rest}개월` : `${rest}개월`,
  };
}

// ── 배정 가능 여부 ────────────────────────────────────────────────────────
//
// 어떤 경우에도 막지 않는다. 서류상 인력, 기간이 안 겹치는 배정, 이미 재경팀과
// 협의된 건 — 정당한 예외가 실재한다. 막으면 사람은 우회로를 만든다.

export type AssignabilityLevel = 'OK' | 'NOTICE' | 'ATTENTION';

export interface Assignability {
  level: AssignabilityLevel;
  /** 사람에게 그대로 보여줄 문장. 기술 용어를 넣지 않는다. */
  message: string;
}

export interface AssignmentPeriod {
  /** YYYY-MM */
  fromMonth: string;
  /** YYYY-MM, 없으면 열린 배정 */
  toMonth?: string | null;
}

function formatMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-');
  return `${year}년 ${Number(month)}월`;
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

export function resolveAssignability(
  person: Person,
  period: AssignmentPeriod,
  today: string,
): Assignability {
  const who = person.nickname ? `${person.name}(${person.nickname})님` : `${person.name}님`;

  if (!isIsoMonth(period.fromMonth)) {
    return {
      level: 'NOTICE',
      message: `배분 기간이 없어 연중 내내 참여하는 것으로 계산됩니다. ${who}의 시작·종료 월을 입력해 주세요.`,
    };
  }

  const from = monthStart(period.fromMonth);
  const to = isIsoMonth(period.toMonth) ? monthEnd(period.toMonth as string) : null;

  const atStart = resolveEmploymentAt(person, from);
  const atEnd = to ? resolveEmploymentAt(person, to) : resolveEmploymentAt(person, today);

  if (!atStart && !atEnd) {
    const separated = resolveSeparationDate(person);
    return {
      level: 'ATTENTION',
      message: separated
        ? `${who}은 ${formatDate(separated)}에 계약이 끝났습니다. 배분 기간(${formatMonth(period.fromMonth)}~)이 재직 기간을 벗어납니다. 서류상 인력이면 그대로 두셔도 되고, 대체 인력이 필요하면 아래에서 찾을 수 있습니다.`
        : `${who}은 명부에 등록된 계약이 없습니다. 인력 관리에서 계약을 먼저 등록해 주세요.`,
    };
  }

  if (!atStart || !atEnd) {
    const separated = resolveSeparationDate(person);
    return {
      level: 'ATTENTION',
      message: separated
        ? `${who}의 계약이 ${formatDate(separated)}에 끝나 배분 기간의 일부만 재직 기간에 들어갑니다. 배분 기간을 줄이거나 대체 인력을 지정해 주세요.`
        : `${who}의 배분 기간 일부가 등록된 계약 기간을 벗어납니다. 계약 또는 배분 기간을 확인해 주세요.`,
    };
  }

  const current = atStart;

  if (current.type === 'PARTNER') {
    return {
      level: 'NOTICE',
      message: `${who}은 파트너·외부 인력입니다. 정규직 참여율과 다르게 처리될 수 있어 재경팀 확인이 필요합니다.`,
    };
  }

  if (current.type === 'PLACEHOLDER') {
    return {
      level: 'NOTICE',
      message: '아직 채용되지 않은 자리입니다. 사람이 정해지면 실제 인력으로 바꿔 주세요.',
    };
  }

  if (current.state !== 'WORKING') {
    return {
      level: 'NOTICE',
      message: `${who}은 ${EMPLOYMENT_STATE_LABELS[current.state]} 중입니다. 서류상 참여율을 유지해야 하는지 확인해 주세요.`,
    };
  }

  return { level: 'OK', message: '' };
}

// ── 계약 변경 / 추가 ──────────────────────────────────────────────────────

export interface EmploymentChangeInput {
  type: EmploymentType;
  state: EmploymentState;
  /** YYYY-MM-DD — 이 날부터 새 계약이 적용된다 (발효일) */
  effectiveFrom: string;
  endDate?: string | null;
  note?: string;
  /** 결정적으로 주입 — 도메인이 시계를 읽지 않는다 */
  id: string;
}

export class EmploymentChangeError extends Error {
  readonly guide: string;

  constructor(guide: string) {
    super(guide);
    this.name = 'EmploymentChangeError';
    this.guide = guide;
  }
}

function assertInput(input: EmploymentChangeInput): void {
  if (!isIsoDate(input.effectiveFrom)) {
    throw new EmploymentChangeError('적용일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  if (input.endDate != null && !isIsoDate(input.endDate)) {
    throw new EmploymentChangeError('종료일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  }
  if (input.endDate != null && input.endDate < input.effectiveFrom) {
    throw new EmploymentChangeError('종료일이 적용일보다 빠릅니다. 날짜를 다시 확인해 주세요.');
  }
  if (!EMPLOYMENT_TYPES.includes(input.type)) {
    throw new EmploymentChangeError('알 수 없는 근로형태입니다.');
  }
  if (!EMPLOYMENT_STATES.includes(input.state)) {
    throw new EmploymentChangeError('알 수 없는 재직상태입니다.');
  }
}

function toEmployment(input: EmploymentChangeInput): PersonEmployment {
  return {
    id: input.id,
    type: input.type,
    state: input.state,
    startDate: input.effectiveFrom,
    endDate: input.endDate ?? null,
    note: (input.note || '').trim(),
  };
}

/**
 * 계약 "변경" — 적용일 직전에 기존 계약을 끝내고 새 계약을 잇는다.
 *
 * 정규직에서 파트너로 넘어가는 전환이 이 경로다. 기존 계약을 지우지 않는다.
 * 지우면 그 기간의 참여율이 왜 정규직 기준이었는지 설명할 근거가 사라진다.
 */
export function changeEmployment(
  person: Person,
  input: EmploymentChangeInput,
): PersonEmployment[] {
  assertInput(input);
  const next = toEmployment(input);
  const closedBefore = previousDay(input.effectiveFrom);

  const kept: PersonEmployment[] = [];
  for (const item of person.employments || []) {
    if (item.startDate >= input.effectiveFrom) {
      throw new EmploymentChangeError(
        `${formatDate(item.startDate)}부터 시작하는 계약이 이미 있습니다. 적용일을 그보다 앞으로 잡거나, 기존 계약을 먼저 정리해 주세요.`,
      );
    }
    if (item.endDate === null || item.endDate >= input.effectiveFrom) {
      kept.push({ ...item, endDate: closedBefore });
      continue;
    }
    kept.push(item);
  }

  return sortByStart([...kept, next]);
}

/**
 * 계약 "추가" — 기존 계약을 건드리지 않고 새 구간을 끼워 넣는다.
 * 공백기를 두고 다시 합류하는 경우(퇴사 후 재입사, 별도 파트너 계약)에 쓴다.
 */
export function addEmployment(
  person: Person,
  input: EmploymentChangeInput,
): PersonEmployment[] {
  assertInput(input);
  const next = toEmployment(input);

  for (const item of person.employments || []) {
    if (overlaps(item, next)) {
      throw new EmploymentChangeError(
        `${formatDate(item.startDate)}부터의 기존 계약과 기간이 겹칩니다. 겹치지 않게 날짜를 조정하거나 "계약 변경"으로 이어 주세요.`,
      );
    }
  }

  return sortByStart([...(person.employments || []), next]);
}

/** 사람 목록에서 특정 시점에 배정 가능한 후보를 고른다 — 퇴사자는 빠지고 휴직자는 남는다. */
export function selectableAt(people: Person[], isoDate: string): Person[] {
  return people.filter((person) => resolveEmploymentAt(person, isoDate) !== null);
}

/** 오늘 유효한 계약이 없는 상태. 퇴사했거나 아직 시작 전이다. */
export const NO_CURRENT_EMPLOYMENT = 'NONE';

export type DirectoryEmploymentType = EmploymentType | typeof NO_CURRENT_EMPLOYMENT;

/** 조회 시점에 유효한 계약의 근로형태. 계약이 없으면 NONE. */
export function resolveEmploymentTypeAt(
  employments: Array<Pick<PersonEmployment, 'type' | 'startDate' | 'endDate'>> | null | undefined,
  isoDate: string,
): DirectoryEmploymentType {
  const list = Array.isArray(employments) ? employments : [];
  const matches = list.filter((item) => (
    item.startDate <= isoDate && (item.endDate === null || item.endDate >= isoDate)
  ));
  if (matches.length === 0) return NO_CURRENT_EMPLOYMENT;
  // 겹치면 늦게 시작한 쪽을 현재로 본다 - resolveEmploymentAt 과 같은 규칙.
  return [...matches].sort((a, b) => a.startDate.localeCompare(b.startDate)).at(-1)!.type;
}

/**
 * 프로젝트 팀에 배정할 수 있는 근로형태인가.
 *
 * 인턴은 사업에 배정하지 않는다. 사람에게 붙는 자격 표시가 아니라 근로형태로 가르는
 * 것이라 명부에는 아무 표시도 남지 않고, 인턴이 정규직이 되면 그냥 따라온다.
 * 파트너와 미채용 자리는 배정 대상이다 - 실제로 사업에 들어가 있다.
 *
 * undefined 는 "근로형태를 모른다"는 뜻이고 거르지 않는다. 명부를 못 읽어 형태 정보가
 * 없는 상황에서 전원을 걸러버리면 아무도 고를 수 없게 된다.
 */
export function isProjectAssignableType(type: DirectoryEmploymentType | undefined): boolean {
  if (type === undefined) return true;
  return type !== 'INTERN' && type !== NO_CURRENT_EMPLOYMENT;
}
