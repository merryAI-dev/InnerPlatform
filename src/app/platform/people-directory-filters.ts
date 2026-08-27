import type { PersonRecord } from '../lib/platform-bff-client';
import { deriveAge, deriveTenure, deriveYearsSinceDegree, type PersonEmployment } from './person-employment';

/**
 * 인력 명부 필터.
 *
 * 표의 각 칸으로 사람을 좁힌다 — "인력 변경 시 적정 대상을 빠르게 찾는다" 가 이 화면의 목적이다.
 *
 * 나이·근속·학위 후 경력은 저장값이 아니라 기준일(asOf)에서 계산한 값으로 거른다. 그래서
 * 필터 결과도 화면에 보이는 숫자와 늘 같다.
 */

export const ANY = '__ANY__';

export interface PeopleFilterState {
  /** 이름·닉네임·소속·직급을 한 칸에서 찾는다. */
  search: string;
  /** WORKING | ON_LEAVE | PARENTAL_LEAVE | SEPARATED | __ANY__ */
  status: string;
  departmentTop: string;
  departmentMid: string;
  grade: string;
  title: string;
  educationCode: string;
  /** 만 나이 최소·최대 (빈칸이면 제한 없음) */
  ageMin: string;
  ageMax: string;
  /** 근속 최소 년수 */
  tenureMinYears: string;
  /** 학위 취득 후 최소 년수 — KOICA 제안서가 보는 값이다. */
  degreeYearsMin: string;
}

export function emptyPeopleFilter(): PeopleFilterState {
  return {
    search: '',
    status: ANY,
    departmentTop: ANY,
    departmentMid: ANY,
    grade: ANY,
    title: ANY,
    educationCode: ANY,
    ageMin: '',
    ageMax: '',
    tenureMinYears: '',
    degreeYearsMin: '',
  };
}

export function isPeopleFilterActive(filter: PeopleFilterState): boolean {
  const base = emptyPeopleFilter();
  return (Object.keys(base) as Array<keyof PeopleFilterState>).some((key) => filter[key] !== base[key]);
}

export interface PeopleFilterRow {
  person: PersonRecord;
  current: PersonEmployment | null;
  separatedAt: string | null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesSearch(person: PersonRecord, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    person.name, person.nickname, person.departmentTop, person.departmentMid,
    person.grade, person.title, person.hrSummary?.highestEducationMajor,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

function matchesStatus(row: PeopleFilterRow, status: string): boolean {
  if (status === ANY) return true;
  if (status === 'SEPARATED') return !row.current;
  return row.current?.state === status;
}

export function filterPeopleRows<T extends PeopleFilterRow>(
  rows: T[],
  filter: PeopleFilterState,
  asOf: string,
): T[] {
  const ageMin = numberOrNull(filter.ageMin);
  const ageMax = numberOrNull(filter.ageMax);
  const tenureMin = numberOrNull(filter.tenureMinYears);
  const degreeMin = numberOrNull(filter.degreeYearsMin);

  return rows.filter((row) => {
    const { person } = row;
    if (!matchesSearch(person, filter.search)) return false;
    if (!matchesStatus(row, filter.status)) return false;
    if (filter.departmentTop !== ANY && String(person.departmentTop || '') !== filter.departmentTop) return false;
    if (filter.departmentMid !== ANY && String(person.departmentMid || '') !== filter.departmentMid) return false;
    if (filter.grade !== ANY && String(person.grade || '') !== filter.grade) return false;
    if (filter.title !== ANY && String(person.title || '') !== filter.title) return false;
    if (filter.educationCode !== ANY && String(person.hrSummary?.highestEducationCode || '') !== filter.educationCode) return false;

    if (ageMin !== null || ageMax !== null) {
      const age = deriveAge(person.birthDate, asOf);
      // 생년월일이 없으면 나이로 거를 수 없다 - 조건을 건 순간 빠진다.
      if (age === null) return false;
      if (ageMin !== null && age < ageMin) return false;
      if (ageMax !== null && age > ageMax) return false;
    }
    if (tenureMin !== null) {
      const tenure = deriveTenure(person.joinedAt, asOf);
      if (!tenure || tenure.months < tenureMin * 12) return false;
    }
    if (degreeMin !== null) {
      const years = deriveYearsSinceDegree(person.hrSummary?.highestDegreeYear, asOf);
      if (years === null || years < degreeMin) return false;
    }
    return true;
  });
}

/** 드롭다운 선택지는 지금 명부에 실제로 있는 값에서 만든다 — 아무도 안 쓰는 값을 고르게 두지 않는다. */
export function collectFilterOptions(people: PersonRecord[]): {
  departmentTop: string[];
  departmentMid: string[];
  grade: string[];
  title: string[];
} {
  const pick = (getter: (person: PersonRecord) => string) => [
    ...new Set(people.map((person) => String(getter(person) || '').trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right, 'ko'));
  return {
    departmentTop: pick((person) => person.departmentTop),
    departmentMid: pick((person) => person.departmentMid),
    grade: pick((person) => person.grade),
    title: pick((person) => person.title),
  };
}
