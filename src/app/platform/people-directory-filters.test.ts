import { describe, expect, it } from 'vitest';
import {
  ANY,
  collectFilterOptions,
  emptyPeopleFilter,
  filterPeopleRows,
  isPeopleFilterActive,
} from './people-directory-filters';
import type { PersonRecord } from '../lib/platform-bff-client';

const ASOF = '2026-08-27';

function person(overrides: Partial<PersonRecord> = {}): PersonRecord {
  return {
    personId: `psn-${overrides.name || 'a'}`,
    name: '김테스트', nickname: '테스트', email: '', departmentTop: '대표이사실', departmentMid: 'EXR팀',
    departmentSub: '', title: '팀장', grade: '책임연구원', birthDate: '1990-03-15', workLocation: '',
    joinedAt: '2020-01-02', employments: [], uid: null, ...overrides,
  };
}

function row(overrides: Partial<PersonRecord> = {}, working = true) {
  const record = person(overrides);
  return {
    person: record,
    current: working ? { id: 'e1', type: 'FULL_TIME', state: 'WORKING', startDate: '2020-01-02', endDate: null, note: '' } as const : null,
    separatedAt: working ? null : '2024-12-31',
  };
}

describe('인력 명부 필터', () => {
  it('이름·닉네임·소속·직급·전공을 한 칸에서 찾는다', () => {
    const rows = [
      row({ name: '김정태' }),
      row({ name: '변민욱', nickname: '보람', departmentMid: 'AXR팀' }),
      row({ name: '이예지', hrSummary: { highestEducationDisplayText: '석사 졸업 · 개발학', highestDegreeYear: '2017', highestEducationCode: 'MASTER_GRADUATED', highestEducationInstitution: 'Sussex', highestEducationMajor: '개발학', englishEvidenceDisplayText: '', certificationsDisplayText: '' } }),
    ];
    const find = (search: string) => filterPeopleRows(rows, { ...emptyPeopleFilter(), search }, ASOF).map((r) => r.person.name);
    expect(find('보람')).toEqual(['변민욱']);
    expect(find('AXR')).toEqual(['변민욱']);
    expect(find('개발학')).toEqual(['이예지']);
    expect(find('')).toHaveLength(3);
  });

  it('재직상태로 거른다 — 계약이 없으면 종료로 본다', () => {
    const rows = [row({ name: '재직자' }), row({ name: '퇴사자' }, false)];
    const byStatus = (status: string) => filterPeopleRows(rows, { ...emptyPeopleFilter(), status }, ASOF).map((r) => r.person.name);
    expect(byStatus('WORKING')).toEqual(['재직자']);
    expect(byStatus('SEPARATED')).toEqual(['퇴사자']);
    expect(byStatus(ANY)).toHaveLength(2);
  });

  it('만 나이·근속·학위 후 경력은 오늘 기준 계산으로 거른다', () => {
    const rows = [
      row({ name: '신입', birthDate: '2003-01-01', joinedAt: '2026-01-01' }),
      row({
        name: '경력', birthDate: '1985-01-01', joinedAt: '2015-01-01',
        hrSummary: { highestEducationDisplayText: '석사 졸업 · 개발학', highestDegreeYear: '2012', highestEducationCode: 'MASTER_GRADUATED', highestEducationInstitution: '', highestEducationMajor: '개발학', englishEvidenceDisplayText: '', certificationsDisplayText: '' },
      }),
    ];
    const names = (patch: Partial<ReturnType<typeof emptyPeopleFilter>>) =>
      filterPeopleRows(rows, { ...emptyPeopleFilter(), ...patch }, ASOF).map((r) => r.person.name);
    expect(names({ ageMin: '30' })).toEqual(['경력']);
    expect(names({ ageMax: '30' })).toEqual(['신입']);
    expect(names({ tenureMinYears: '5' })).toEqual(['경력']);
    // KOICA 제안서가 보는 값 — 학위 취득 후 몇 년.
    expect(names({ degreeYearsMin: '10' })).toEqual(['경력']);
    // 학위취득년도가 없는 사람은 그 조건을 건 순간 빠진다.
    expect(names({ degreeYearsMin: '1' })).toEqual(['경력']);
  });

  it('선택지는 지금 명부에 실제로 있는 값에서만 만든다', () => {
    const options = collectFilterOptions([
      person({ name: 'a', departmentTop: '대표이사실', grade: '연구원', title: '' }),
      person({ name: 'b', departmentTop: '', grade: '매니저', title: '팀장' }),
    ]);
    expect(options.departmentTop).toEqual(['대표이사실']);
    expect(options.grade).toEqual(['매니저', '연구원']);
    expect(options.title).toEqual(['팀장']);
  });

  it('아무 조건도 안 걸면 활성으로 보지 않는다', () => {
    expect(isPeopleFilterActive(emptyPeopleFilter())).toBe(false);
    expect(isPeopleFilterActive({ ...emptyPeopleFilter(), grade: '연구원' })).toBe(true);
  });
});
