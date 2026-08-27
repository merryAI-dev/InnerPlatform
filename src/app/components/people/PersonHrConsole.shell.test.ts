import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  changedPersonProfileFields,
  personProfileFormFromRecord,
  type PersonProfileFormValue,
} from './PersonHrConsole';
import type { PersonRecord } from '../../lib/platform-bff-client';

const source = readFileSync(resolve(import.meta.dirname, 'PersonHrConsole.tsx'), 'utf8');

const PERSON: PersonRecord = {
  personId: 'psn-a', name: '변민욱', nickname: '보람', email: 'mw@mysc.co.kr',
  departmentTop: '대표이사실', departmentMid: 'AXR팀', departmentSub: '',
  title: '팀장', grade: '책임연구원', birthDate: '1996-12-20', workLocation: '서울',
  joinedAt: '2025-04-02', employments: [], uid: null,
};

describe('인사정보 콘솔', () => {
  it('바뀐 칸만 저장 대상으로 추린다 — 부분 갱신이라 안 바뀐 값까지 보내면 감사 기록이 뜻을 잃는다', () => {
    const before = personProfileFormFromRecord(PERSON);
    expect(changedPersonProfileFields(before, before)).toEqual({});

    const after: PersonProfileFormValue = { ...before, grade: '수석컨설턴트', title: '센터장' };
    expect(changedPersonProfileFields(before, after)).toEqual({ grade: '수석컨설턴트', title: '센터장' });
  });

  it('생년월일은 날짜 부분만 폼에 담는다', () => {
    expect(personProfileFormFromRecord({ ...PERSON, birthDate: '1996-12-20T00:00:00.000Z' }).birthDate)
      .toBe('1996-12-20');
    expect(personProfileFormFromRecord({ ...PERSON, birthDate: '' }).birthDate).toBe('');
  });

  it('그룹웨어 인사기록카드 구조를 지킨다 — 기본정보·인사정보조회·상세정보', () => {
    expect(source).toContain('<TabsTrigger value="basic"');
    expect(source).toContain('<TabsTrigger value="records"');
    expect(source).toContain('<TabsTrigger value="detail"');
    expect(source).toContain('데이터가 존재하지 않습니다.');
    expect(source).toContain('{count}건');
  });

  it('만 나이·근속·학위 후 경력은 저장값이 아니라 오늘 기준 계산이다', () => {
    expect(source).toContain('deriveAge(person.birthDate, asOf)');
    expect(source).toContain('deriveTenure(person.joinedAt, asOf)');
    // KOICA 제안서가 '학위 취득 후 경력 몇 년' 을 본다. 학력 카드를 열지 않고 머리에서 읽힌다.
    expect(source).toContain('deriveYearsSinceDegree(highestEducation?.degreeYear, asOf)');
    expect(source).toContain('label="최종학력"');
    expect(source).toContain('label="학위취득"');
    expect(source).not.toContain('person.age');
  });

  it('읽는 크기를 지킨다 — DESIGN.md 본문 14~15px, 팝업은 넓게', () => {
    // 처음엔 11~13px 로 만들어 화면이 깨졌다. 조밀한 것은 되지만 비좁은 것은 안 된다.
    expect(source).toContain('max-w-[1120px]');
    expect(source).not.toContain('text-[11px]');
    expect(source).not.toContain('max-w-[940px]');
  });

  it('직급은 설정 목록에서 고르되 별도 직급체계는 직접 입력으로 남긴다', () => {
    // 직급 목록도 설정에서 뻗어 나온다. 코드 카탈로그는 설정이 없을 때의 기본값이다.
    expect(source).toContain('usePersonGradeSettings');
    expect(source).toContain('formatGradeOptionLabel(grade)');
    expect(source).toContain('직급과 다른 축입니다');
    // 경영기획실(재경)·사내벤처는 별도 체계를 쓴다. 목록으로 막으면 그 사람들이 저장을 못 한다.
    expect(source).toContain('직접 입력 (별도 직급체계)');
    expect(source).toContain('aria-label="직급 직접 입력"');
  });
});
