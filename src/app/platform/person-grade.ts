import catalog from '../../../policies/person-grades.json';

/**
 * 직급 — 오피스핸드북 목록이 단일 출처(`policies/person-grades.json`)다.
 *
 * 직책(팀장·센터장 등)과 다른 축이다. 직책은 `Person.title` 에 자유 입력으로 남는다.
 * 저장값은 라벨이고, 대응 일반직급(equivalentTitles)은 대외 문서 표기라 화면 힌트로만 쓴다.
 */

export interface PersonGrade {
  code: string;
  label: string;
  rank: number;
  equivalentTitles: string[];
}

export const PERSON_GRADES: PersonGrade[] = catalog.grades.map((grade) => ({
  code: grade.code,
  label: grade.label,
  rank: grade.rank,
  equivalentTitles: [...grade.equivalentTitles],
}));

const gradeByLabel = new Map(PERSON_GRADES.map((grade) => [grade.label, grade]));

export function findPersonGrade(label: unknown): PersonGrade | null {
  return gradeByLabel.get(String(label || '').trim()) || null;
}

export function isKnownPersonGrade(label: unknown): boolean {
  return gradeByLabel.has(String(label || '').trim());
}

/** '책임연구원 (대리·과장)' — 목록에서 고를 때 대외 직급이 무엇인지 같이 읽히게 한다. */
export function formatPersonGradeOption(grade: PersonGrade): string {
  return grade.equivalentTitles.length > 0
    ? `${grade.label} (${grade.equivalentTitles.join('·')})`
    : grade.label;
}
