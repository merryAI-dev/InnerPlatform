export const PROJECT_DEPARTMENT_OPTIONS = [
  '미지정',
  'CIC1',
  'CIC2',
  'CIC3',
  'CIC4',
  '글로벌센터',
  '개발협력센터',
  '공간플랫폼센터',
  '투자센터',
  '조인트액션',
  'CI그룹',
  'AXR팀',
  'DXR팀',
] as const;

export type ProjectDepartmentOption = (typeof PROJECT_DEPARTMENT_OPTIONS)[number];

export interface ProjectDepartmentSettingsOption {
  id: string;
  label: string;
  sortOrder: number;
  active?: boolean;
}

function hashLabel(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function createProjectDepartmentOptionId(label: string): string {
  const normalized = label.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || `department-${hashLabel(label)}`;
}

export function normalizeProjectDepartmentOptionLabel(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^cic\s*([1-4])$/i.test(raw)) return `CIC${raw.match(/[1-4]/)?.[0] || ''}`;
  const teamMatch = raw.match(/^([a-z]{2,10})\s*team$/i);
  if (teamMatch?.[1]) return `${teamMatch[1].toUpperCase()}팀`;
  return raw;
}

export function dedupeProjectDepartmentLabels(values: unknown[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  values.forEach((value) => {
    const label = normalizeProjectDepartmentOptionLabel(value);
    if (!label || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  });
  return labels;
}

export function buildProjectDepartmentSettingsOptions(labels: unknown[]): ProjectDepartmentSettingsOption[] {
  const usedIds = new Map<string, number>();
  return dedupeProjectDepartmentLabels(labels).map((label, index) => {
    const baseId = createProjectDepartmentOptionId(label);
    const nextCount = (usedIds.get(baseId) || 0) + 1;
    usedIds.set(baseId, nextCount);
    return {
      id: nextCount === 1 ? baseId : `${baseId}-${nextCount}`,
      label,
      sortOrder: index,
      active: true,
    };
  });
}

export function resolveProjectDepartmentSettingsOptions(
  settingsData: unknown,
  fallbackLabels: readonly string[] = PROJECT_DEPARTMENT_OPTIONS,
): string[] {
  if (!settingsData || typeof settingsData !== 'object') {
    return dedupeProjectDepartmentLabels([...fallbackLabels]);
  }

  const rawOptions = Array.isArray((settingsData as { options?: unknown }).options)
    ? (settingsData as { options: unknown[] }).options
    : [];

  const configuredLabels = [...rawOptions]
      .filter((option) => !option || typeof option !== 'object' || (option as { active?: unknown }).active !== false)
      .sort((a, b) => {
        const aOrder = a && typeof a === 'object' ? Number((a as { sortOrder?: unknown }).sortOrder) : Number.NaN;
        const bOrder = b && typeof b === 'object' ? Number((b as { sortOrder?: unknown }).sortOrder) : Number.NaN;
        const aRank = Number.isFinite(aOrder) ? aOrder : Number.MAX_SAFE_INTEGER;
        const bRank = Number.isFinite(bOrder) ? bOrder : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        const aLabel = a && typeof a === 'object' ? String((a as { label?: unknown }).label || '') : String(a || '');
        const bLabel = b && typeof b === 'object' ? String((b as { label?: unknown }).label || '') : String(b || '');
        return aLabel.localeCompare(bLabel, 'ko');
      })
      .map((option) => (option && typeof option === 'object' ? (option as { label?: unknown }).label : option));

  return dedupeProjectDepartmentLabels([
    ...configuredLabels,
    ...fallbackLabels,
  ]);
}
