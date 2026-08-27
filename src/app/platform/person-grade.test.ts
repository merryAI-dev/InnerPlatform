import { describe, expect, it } from 'vitest';
import {
  PERSON_GRADES,
  findPersonGrade,
  formatPersonGradeOption,
  isKnownPersonGrade,
} from './person-grade';

describe('직급 카탈로그', () => {
  it('오피스핸드북 8개 직급을 순위 순서로 담는다', () => {
    expect(PERSON_GRADES.map((grade) => grade.label)).toEqual([
      '인턴연구원', '연구원', '선임연구원', '책임연구원',
      '컨설턴트', '선임컨설턴트', '책임컨설턴트', '수석컨설턴트',
    ]);
    expect(PERSON_GRADES.map((grade) => grade.rank)).toEqual([...PERSON_GRADES.map((grade) => grade.rank)].sort((a, b) => a - b));
  });

  it('대응 일반직급을 함께 읽히게 적는다 — 저장값은 직급 라벨뿐이다', () => {
    expect(formatPersonGradeOption(findPersonGrade('책임연구원')!)).toBe('책임연구원 (대리·과장)');
    expect(formatPersonGradeOption(findPersonGrade('수석컨설턴트')!)).toBe('수석컨설턴트 (부장·이사·상무·전무·부대표)');
  });

  it('목록에 없는 값은 직급으로 인정하지 않는다 — 직책과 섞이지 않게 한다', () => {
    expect(isKnownPersonGrade('선임연구원')).toBe(true);
    expect(isKnownPersonGrade('팀장')).toBe(false);
    expect(isKnownPersonGrade('대리')).toBe(false);
    expect(isKnownPersonGrade('')).toBe(false);
    expect(findPersonGrade('팀장')).toBeNull();
  });
});
