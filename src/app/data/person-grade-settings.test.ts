import { describe, expect, it } from 'vitest';
import {
  activeGradeLabels,
  buildDefaultPersonGradeOptions,
  buildPersonGradeSettingsDoc,
  formatGradeOptionLabel,
  resolvePersonGradeOptions,
} from './person-grade-settings';

describe('직급 목록 설정', () => {
  it('설정 문서가 없으면 코드 카탈로그로 시작한다', () => {
    const grades = resolvePersonGradeOptions(null);
    expect(grades.map((grade) => grade.label)).toEqual([
      '인턴', '연구원', '선임연구원', '책임연구원',
      '컨설턴트', '선임컨설턴트', '책임컨설턴트', '수석컨설턴트',
      '이사', '부대표', '대표이사',
    ]);
  });

  it('별도 직급체계를 목록에 더할 수 있다 — 그러면 더 이상 어긋난 값이 아니다', () => {
    // 경영기획실(재경)·사내벤처가 쓰는 값이다. 목록에 넣으면 정상 선택지가 된다.
    const grades = resolvePersonGradeOptions({
      grades: [
        { id: 'manager', label: '매니저', sortOrder: 0, active: true },
        { id: 'venture', label: '벤처 전문위원', sortOrder: 1, active: true, equivalentTitles: [] },
      ],
    });
    expect(activeGradeLabels(grades)).toEqual(['매니저', '벤처 전문위원']);
  });

  it('숨긴 직급은 새로 고를 수 없지만 목록에서 사라지지는 않는다', () => {
    const grades = buildDefaultPersonGradeOptions()
      .map((grade) => (grade.label === '인턴' ? { ...grade, active: false } : grade));
    expect(activeGradeLabels(grades)).not.toContain('인턴');
    expect(grades.map((grade) => grade.label)).toContain('인턴');
  });

  it('대응 일반직급은 화면 힌트로만 붙고 임원에는 붙지 않는다', () => {
    const grades = buildDefaultPersonGradeOptions();
    const find = (label: string) => grades.find((grade) => grade.label === label)!;
    expect(formatGradeOptionLabel(find('책임연구원'))).toBe('책임연구원 (대리·과장)');
    expect(formatGradeOptionLabel(find('대표이사'))).toBe('대표이사');
  });

  it('저장 문서는 순서를 다시 매기고 누가 언제 고쳤는지 남긴다', () => {
    const doc = buildPersonGradeSettingsDoc({
      grades: buildDefaultPersonGradeOptions(),
      actorId: 'actor-a',
      now: '2026-08-27T00:00:00.000Z',
    });
    expect(doc.version).toBe(1);
    expect(doc.updatedBy).toBe('actor-a');
    expect(doc.grades.map((grade) => grade.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
