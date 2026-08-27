import { PERSON_GRADES } from '../platform/person-grade';

/**
 * 직급 목록.
 *
 * 조직과 같은 이유로 설정에 둔다 — 직급 체계도 개편된다. 코드 카탈로그
 * (`policies/person-grades.json`)는 설정 문서가 없을 때 쓰는 기본값이다.
 *
 * 경영기획실(재경)과 사내벤처는 별도 직급체계를 쓴다. 목록에 없는 값도 저장되며,
 * 설정 화면에서 "목록에 없는 직급"으로 보여 주고 관리자가 정리하거나 목록에 추가한다.
 */

export interface PersonGradeOption {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
  /** 대외 문서용 대응 직급. 화면 힌트일 뿐 저장하지 않는다. */
  equivalentTitles: string[];
}

export interface PersonGradeSettingsDoc {
  version: 1;
  grades: PersonGradeOption[];
  updatedAt?: string;
  updatedBy?: string;
}

export const PERSON_GRADE_SETTINGS_DOC_ID = 'person-grades';
export const PERSON_GRADE_SETTINGS_PATH = `settings/${PERSON_GRADE_SETTINGS_DOC_ID}`;

export function buildDefaultPersonGradeOptions(): PersonGradeOption[] {
  return PERSON_GRADES.map((grade, index) => ({
    id: grade.code,
    label: grade.label,
    sortOrder: index,
    active: true,
    equivalentTitles: [...grade.equivalentTitles],
  }));
}

export function normalizePersonGradeOptions(value: unknown): PersonGradeOption[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return rows
    .flatMap((row, index) => {
      if (!row || typeof row !== 'object') return [];
      const source = row as Partial<PersonGradeOption>;
      const label = String(source.label ?? '').trim();
      if (!label || seen.has(label)) return [];
      seen.add(label);
      return [{
        id: String(source.id ?? '').trim() || `grade-${index}`,
        label,
        sortOrder: Number.isFinite(source.sortOrder) ? Number(source.sortOrder) : index,
        active: source.active !== false,
        equivalentTitles: Array.isArray(source.equivalentTitles)
          ? source.equivalentTitles.map((title) => String(title).trim()).filter(Boolean)
          : [],
      }];
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function resolvePersonGradeOptions(doc: unknown): PersonGradeOption[] {
  const grades = normalizePersonGradeOptions((doc as { grades?: unknown } | null)?.grades);
  return grades.length > 0 ? grades : buildDefaultPersonGradeOptions();
}

export function activeGradeLabels(grades: PersonGradeOption[]): string[] {
  return grades.filter((grade) => grade.active).map((grade) => grade.label);
}

export function buildPersonGradeSettingsDoc(input: {
  grades: PersonGradeOption[];
  actorId?: string;
  now?: string;
}): PersonGradeSettingsDoc {
  return {
    version: 1,
    grades: normalizePersonGradeOptions(input.grades).map((grade, index) => ({ ...grade, sortOrder: index })),
    updatedAt: input.now || new Date().toISOString(),
    updatedBy: input.actorId || 'system',
  };
}

/** '책임연구원 (대리·과장)' — 목록에서 고를 때 대외 직급이 무엇인지 같이 읽히게 한다. */
export function formatGradeOptionLabel(grade: PersonGradeOption): string {
  return grade.equivalentTitles.length > 0
    ? `${grade.label} (${grade.equivalentTitles.join('·')})`
    : grade.label;
}
