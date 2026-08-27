import catalog from '../../policies/person-grades.json' with { type: 'json' };

/**
 * 직급 카탈로그. 오피스핸드북 목록이 단일 출처다.
 *
 * 저장값은 라벨(예: '선임연구원')이다. 코드로 바꾸면 이미 명부에 들어있는 값이 전부
 * 뜻을 잃는다. equivalentTitles 는 대외 문서용 대응 표기라 저장하지 않는다.
 */

function validate(value) {
  if (value?.catalogVersion !== 1) throw new Error('person grade catalogVersion must be 1');
  if (!Array.isArray(value.grades) || value.grades.length === 0) {
    throw new Error('person grades are required');
  }
  const labels = value.grades.map((grade) => grade.label);
  const codes = value.grades.map((grade) => grade.code);
  const ranks = value.grades.map((grade) => grade.rank);
  if (new Set(labels).size !== labels.length) throw new Error('person grade labels must be unique');
  if (new Set(codes).size !== codes.length) throw new Error('person grade codes must be unique');
  if (new Set(ranks).size !== ranks.length) throw new Error('person grade ranks must be unique');
  return Object.freeze({
    catalogVersion: value.catalogVersion,
    grades: Object.freeze(value.grades.map((grade) => Object.freeze({
      ...grade,
      equivalentTitles: Object.freeze([...(grade.equivalentTitles || [])]),
    }))),
  });
}

const frozenCatalog = validate(catalog);
const labelSet = new Set(frozenCatalog.grades.map((grade) => grade.label));

export function getPersonGradeCatalog() {
  return frozenCatalog;
}

export function isKnownPersonGrade(value) {
  return labelSet.has(String(value || '').trim());
}
