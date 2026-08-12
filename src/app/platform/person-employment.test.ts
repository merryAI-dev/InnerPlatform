import { describe, expect, it } from 'vitest';
import {
  addEmployment,
  changeEmployment,
  deriveTenure,
  EmploymentChangeError,
  resolveAssignability,
  resolveCurrentEmployment,
  resolveEmploymentAt,
  resolveSeparationDate,
  selectableAt,
  type Person,
  type PersonEmployment,
} from './person-employment';

const TODAY = '2026-08-12';

function person(overrides: Partial<Person> = {}): Person {
  return {
    personId: 'psn-test',
    name: '김세은',
    nickname: '람쥐',
    email: 'sekim@mysc.co.kr',
    departmentTop: '대표이사실',
    departmentMid: 'EXR팀',
    departmentSub: '',
    title: '실장/팀장',
    grade: '책임컨설턴트',
    workLocation: '',
    joinedAt: '2015-04-10',
    uid: 'uid-1',
    employments: [{
      id: 'emp-1', type: 'FULL_TIME', state: 'WORKING',
      startDate: '2015-04-10', endDate: null, note: '',
    }],
    ...overrides,
  };
}

function employment(overrides: Partial<PersonEmployment> = {}): PersonEmployment {
  return {
    id: 'emp-x', type: 'FULL_TIME', state: 'WORKING',
    startDate: '2020-01-01', endDate: null, note: '',
    ...overrides,
  };
}

describe('근속 계산', () => {
  it('입사일과 기준일에서 년·월을 뽑는다', () => {
    expect(deriveTenure('2015-04-10', '2026-08-12')).toEqual({
      months: 136, years: 11.3, label: '11년 4개월',
    });
  });

  it('1년 미만은 개월만 표시한다', () => {
    expect(deriveTenure('2026-06-01', '2026-08-12')?.label).toBe('2개월');
  });

  it('기준일이 입사일 이전이면 계산하지 않는다', () => {
    expect(deriveTenure('2026-09-01', '2026-08-12')).toBeNull();
  });

  it('같은 입사일이라도 기준일이 바뀌면 값이 바뀐다 — 그래서 저장값이 아니라 파생값이어야 한다', () => {
    expect(deriveTenure('2015-04-10', '2026-08-12')?.months).toBe(136);
    expect(deriveTenure('2015-04-10', '2027-08-12')?.months).toBe(148);
  });
});

describe('시점별 계약 조회', () => {
  it('열린 계약은 오늘을 포함한다', () => {
    expect(resolveCurrentEmployment(person(), TODAY)?.type).toBe('FULL_TIME');
  });

  it('끝난 계약은 종료일 다음날부터 포함하지 않는다', () => {
    const p = person({ employments: [employment({ startDate: '2020-01-01', endDate: '2025-11-30' })] });
    expect(resolveEmploymentAt(p, '2025-11-30')?.id).toBe('emp-x');
    expect(resolveEmploymentAt(p, '2025-12-01')).toBeNull();
  });

  it('열린 계약이 하나라도 있으면 퇴사일은 없다', () => {
    expect(resolveSeparationDate(person())).toBeNull();
  });

  it('모든 계약이 끝났으면 마지막 종료일이 퇴사일이다', () => {
    const p = person({ employments: [
      employment({ id: 'a', startDate: '2020-01-01', endDate: '2023-12-31' }),
      employment({ id: 'b', startDate: '2024-01-01', endDate: '2025-11-30' }),
    ] });
    expect(resolveSeparationDate(p)).toBe('2025-11-30');
  });
});

describe('계약 변경 — 노성진 케이스 (정규직 → 파트너)', () => {
  const 노성진 = person({
    personId: 'psn-nosj', name: '노성진', nickname: '', email: '', uid: null,
    joinedAt: '2022-03-02',
    employments: [employment({ id: 'emp-ft', startDate: '2022-03-02', endDate: null })],
  });

  it('기존 계약을 적용일 직전에 닫고 새 계약을 잇는다', () => {
    const next = changeEmployment(노성진, {
      id: 'emp-partner', type: 'PARTNER', state: 'WORKING',
      effectiveFrom: '2026-01-01', note: '퇴사 후 파트너 전환',
    });

    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ id: 'emp-ft', type: 'FULL_TIME', endDate: '2025-12-31' });
    expect(next[1]).toMatchObject({ id: 'emp-partner', type: 'PARTNER', startDate: '2026-01-01', endDate: null });
  });

  it('기존 계약을 지우지 않는다 — 그 기간의 참여율 근거가 남아야 한다', () => {
    const next = changeEmployment(노성진, {
      id: 'emp-partner', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01',
    });
    const at2023 = resolveEmploymentAt({ ...노성진, employments: next }, '2023-06-01');
    expect(at2023?.type).toBe('FULL_TIME');
  });

  it('전환 이후 시점은 파트너로 조회된다', () => {
    const next = changeEmployment(노성진, {
      id: 'emp-partner', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01',
    });
    expect(resolveEmploymentAt({ ...노성진, employments: next }, TODAY)?.type).toBe('PARTNER');
  });

  it('적용일보다 늦게 시작하는 계약이 이미 있으면 안내와 함께 거절한다', () => {
    const p = person({ employments: [employment({ startDate: '2027-01-01', endDate: null })] });
    expect(() => changeEmployment(p, {
      id: 'x', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01',
    })).toThrow(EmploymentChangeError);
  });

  it('잘못된 날짜 형식은 사람이 읽을 수 있는 안내를 준다', () => {
    expect(() => changeEmployment(노성진, {
      id: 'x', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026/01/01',
    })).toThrow('적용일을 YYYY-MM-DD 형식으로 입력해 주세요.');
  });
});

describe('계약 추가 — 공백기를 둔 별도 계약', () => {
  const p = person({ employments: [employment({ id: 'a', startDate: '2020-01-01', endDate: '2024-12-31' })] });

  it('겹치지 않으면 끼워 넣는다', () => {
    const next = addEmployment(p, {
      id: 'b', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-01-01', endDate: '2026-12-31',
    });
    expect(next.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('기간이 겹치면 변경을 쓰라고 안내한다', () => {
    expect(() => addEmployment(p, {
      id: 'b', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2024-06-01',
    })).toThrow(/겹칩니다/);
  });

  it('종료일이 적용일보다 빠르면 거절한다', () => {
    expect(() => addEmployment(p, {
      id: 'b', type: 'PARTNER', state: 'WORKING', effectiveFrom: '2026-06-01', endDate: '2026-01-01',
    })).toThrow(/종료일이 적용일보다 빠릅니다/);
  });
});

describe('배정 가능 여부 — 어떤 경우에도 막지 않는다', () => {
  it('재직 중 정규직이 기간 전체를 덮으면 조용하다', () => {
    const result = resolveAssignability(person(), { fromMonth: '2026-01', toMonth: '2026-12' }, TODAY);
    expect(result).toEqual({ level: 'OK', message: '' });
  });

  it('퇴사자 배정은 퇴사일을 말하고 대안을 제시한다', () => {
    const 김혜령 = person({
      name: '김혜령', nickname: '테일러',
      employments: [employment({ startDate: '2021-01-01', endDate: '2025-11-30' })],
    });
    const result = resolveAssignability(김혜령, { fromMonth: '2026-01', toMonth: '2026-05' }, TODAY);
    expect(result.level).toBe('ATTENTION');
    expect(result.message).toContain('김혜령(테일러)님');
    expect(result.message).toContain('2025년 11월 30일');
    expect(result.message).toContain('대체 인력');
  });

  it('기간 일부만 재직 기간을 벗어나도 알려준다', () => {
    const p = person({ employments: [employment({ startDate: '2020-01-01', endDate: '2026-03-31' })] });
    const result = resolveAssignability(p, { fromMonth: '2026-01', toMonth: '2026-12' }, TODAY);
    expect(result.level).toBe('ATTENTION');
    expect(result.message).toContain('일부만');
  });

  it('파트너는 재경팀 확인을 안내한다', () => {
    const p = person({ name: '노성진', nickname: '', employments: [employment({ type: 'PARTNER' })] });
    const result = resolveAssignability(p, { fromMonth: '2026-01', toMonth: '2026-12' }, TODAY);
    expect(result.level).toBe('NOTICE');
    expect(result.message).toContain('재경팀');
  });

  it('휴직 중이어도 배정을 막지 않고 확인만 요청한다', () => {
    const p = person({ employments: [employment({ state: 'PARENTAL_LEAVE' })] });
    const result = resolveAssignability(p, { fromMonth: '2026-01', toMonth: '2026-12' }, TODAY);
    expect(result.level).toBe('NOTICE');
    expect(result.message).toContain('육아휴직');
  });

  it('배분 기간이 없으면 연중으로 계산된다고 알린다', () => {
    const result = resolveAssignability(person(), { fromMonth: '' }, TODAY);
    expect(result.level).toBe('NOTICE');
    expect(result.message).toContain('연중 내내');
  });

  it('미채용 자리는 사람으로 바꾸라고 안내한다', () => {
    const p = person({ name: '신규채용1', nickname: '', employments: [employment({ type: 'PLACEHOLDER' })] });
    expect(resolveAssignability(p, { fromMonth: '2026-06', toMonth: '2026-12' }, TODAY).level).toBe('NOTICE');
  });

  it('어떤 조합에서도 ATTENTION 이 최대이고 차단 등급은 없다', () => {
    const 퇴사자 = person({ employments: [employment({ endDate: '2020-01-02' })] });
    const levels = [
      resolveAssignability(person(), { fromMonth: '2026-01' }, TODAY).level,
      resolveAssignability(퇴사자, { fromMonth: '2026-01' }, TODAY).level,
      resolveAssignability(person({ employments: [] }), { fromMonth: '2026-01' }, TODAY).level,
    ];
    expect(levels.every((level) => ['OK', 'NOTICE', 'ATTENTION'].includes(level))).toBe(true);
  });
});

describe('배정 후보 선별', () => {
  const people = [
    person({ personId: 'a', name: '재직자' }),
    person({ personId: 'b', name: '퇴사자', employments: [employment({ endDate: '2025-11-30' })] }),
    person({ personId: 'c', name: '휴직자', employments: [employment({ state: 'ON_LEAVE' })] }),
    person({ personId: 'd', name: '파트너', employments: [employment({ type: 'PARTNER' })] }),
  ];

  it('퇴사자만 빠지고 휴직자·파트너는 남는다 — 고를 수는 있어야 한다', () => {
    expect(selectableAt(people, TODAY).map((item) => item.personId)).toEqual(['a', 'c', 'd']);
  });

  it('과거 시점으로 물으면 퇴사자도 후보다', () => {
    expect(selectableAt(people, '2025-06-01').map((item) => item.personId)).toEqual(['a', 'b', 'c', 'd']);
  });
});
