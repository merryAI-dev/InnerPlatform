export const PROJECT_DEPARTMENT_OPTIONS = [
  '미지정',
  'CIC1',
  'CIC2',
  'CIC3',
  'CIC4',
  '글로벌센터',
  '개발협력센터',
  '투자센터',
  '조인트액션',
  'CI그룹',
  'AXR팀',
  'DXR팀',
] as const;

export type ProjectDepartmentOption = (typeof PROJECT_DEPARTMENT_OPTIONS)[number];
