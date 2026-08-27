import { describe, expect, it } from 'vitest';
import {
  PERSON_GRADES,
  findPersonGrade,
  formatPersonGradeOption,
  isKnownPersonGrade,
} from './person-grade';

describe('직급 카탈로그', () => {
  it('전사 직급체계를 순위 순서로 담는다 — 임원까지 포함한다', () => {
    // 재직자 현황 시트의 직급체계가 출처다. 임원(이사·부대표·대표이사)도 실제 직급이다.
    expect(PERSON_GRADES.map((grade) => grade.label)).toEqual([
      '인턴연구원', '연구원', '선임연구원', '책임연구원',
      '컨설턴트', '선임컨설턴트', '책임컨설턴트', '수석컨설턴트',
      '이사', '부대표', '대표이사',
    ]);
    expect(PERSON_GRADES.map((grade) => grade.rank)).toEqual([...PERSON_GRADES.map((grade) => grade.rank)].sort((a, b) => a - b));
  });

  it('대응 일반직급을 함께 읽히게 적는다 — 저장값은 직급 라벨뿐이다', () => {
    expect(formatPersonGradeOption(findPersonGrade('책임연구원')!)).toBe('책임연구원 (대리·과장)');
    expect(formatPersonGradeOption(findPersonGrade('수석컨설턴트')!)).toBe('수석컨설턴트 (부장·상무·전무)');
    // 임원은 그 자체가 대외 직급이라 대응 표기를 붙이지 않는다.
    expect(formatPersonGradeOption(findPersonGrade('대표이사')!)).toBe('대표이사');
  });

  it('목록 밖 값은 카탈로그로 인정하지 않되 저장까지 막지는 않는다', () => {
    expect(isKnownPersonGrade('선임연구원')).toBe(true);
    expect(isKnownPersonGrade('대표이사')).toBe(true);
    // 경영기획실(재경)·사내벤처는 별도 직급체계를 쓴다. 이 값들은 화면에서 '직접 입력'으로 다룬다.
    expect(isKnownPersonGrade('매니저')).toBe(false);
    expect(isKnownPersonGrade('벤처 전문위원')).toBe(false);
    expect(isKnownPersonGrade('')).toBe(false);
    expect(findPersonGrade('매니저')).toBeNull();
  });
});
