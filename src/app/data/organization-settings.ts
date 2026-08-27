/**
 * 조직(소속) 목록.
 *
 * 조직 개편은 코드 배포와 무관하게 일어난다(CIC1 → 스템CIC). 그래서 목록은 설정 문서에 두고
 * 관리자가 고친다. 저장되는 값은 **이름 문자열**이다 — id 로 바꾸면 이미 쌓인 인력·프로젝트
 * 데이터를 전부 옮겨야 하고, 그 마이그레이션이 개편보다 위험하다.
 *
 * 대신 이름을 바꿀 때 그 이름을 쓰던 데이터를 함께 옮기는 '일괄 변경'을 관리자가 고른다.
 * 지우기 대신 비활성화만 두는 것도 같은 이유다 - 쓰이던 이름이 화면에서 사라지면 안 된다.
 */

export interface OrganizationTeam {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface OrganizationGroup {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
  teams: OrganizationTeam[];
}

export interface OrganizationSettingsDoc {
  version: 1;
  groups: OrganizationGroup[];
  updatedAt?: string;
  updatedBy?: string;
}

export const ORGANIZATION_SETTINGS_DOC_ID = 'organizations';
export const ORGANIZATION_SETTINGS_PATH = `settings/${ORGANIZATION_SETTINGS_DOC_ID}`;

/** 설정 문서가 없을 때 쓰는 기본 조직. 라이브 인력 명부의 실제 구조에서 뽑았다. */
export const DEFAULT_ORGANIZATION_GROUPS: Array<{ label: string; teams: string[] }> = [
  { label: '대표이사실', teams: ['EXR팀', 'AXR팀', 'DXR팀'] },
  { label: '리더십·전략 총괄그룹', teams: ['글로벌센터', '개발협력센터'] },
  { label: '자본·투자 운용그룹', teams: ['투자센터', '공간플랫폼센터', '경영기획실'] },
  { label: 'CIC 사내벤처기업', teams: ['CIC 1', 'CIC 2', 'CIC 3', 'CIC 4'] },
];

function slugId(label: string, fallbackPrefix: string): string {
  const normalized = label.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣·-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || `${fallbackPrefix}-${Math.abs(hashLabel(label)).toString(36)}`;
}

function hashLabel(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

export function buildDefaultOrganizationGroups(): OrganizationGroup[] {
  return DEFAULT_ORGANIZATION_GROUPS.map((group, groupIndex) => ({
    id: slugId(group.label, 'group'),
    label: group.label,
    sortOrder: groupIndex,
    active: true,
    teams: group.teams.map((team, teamIndex) => ({
      id: slugId(team, 'team'),
      label: team,
      sortOrder: teamIndex,
      active: true,
    })),
  }));
}

function normalizeTeam(value: unknown, index: number): OrganizationTeam | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<OrganizationTeam>;
  const label = String(source.label ?? '').trim();
  if (!label) return null;
  return {
    id: String(source.id ?? '').trim() || slugId(label, 'team'),
    label,
    sortOrder: Number.isFinite(source.sortOrder) ? Number(source.sortOrder) : index,
    active: source.active !== false,
  };
}

export function normalizeOrganizationGroups(value: unknown): OrganizationGroup[] {
  const rows = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  return rows
    .flatMap((row, index) => {
      if (!row || typeof row !== 'object') return [];
      const source = row as Partial<OrganizationGroup>;
      const label = String(source.label ?? '').trim();
      if (!label || seen.has(label)) return [];
      seen.add(label);
      const teamLabels = new Set<string>();
      const teams = (Array.isArray(source.teams) ? source.teams : [])
        .flatMap((team, teamIndex) => {
          const normalized = normalizeTeam(team, teamIndex);
          if (!normalized || teamLabels.has(normalized.label)) return [];
          teamLabels.add(normalized.label);
          return [normalized];
        })
        .sort((left, right) => left.sortOrder - right.sortOrder);
      return [{
        id: String(source.id ?? '').trim() || slugId(label, 'group'),
        label,
        sortOrder: Number.isFinite(source.sortOrder) ? Number(source.sortOrder) : index,
        active: source.active !== false,
        teams,
      }];
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function resolveOrganizationGroups(doc: unknown): OrganizationGroup[] {
  const groups = normalizeOrganizationGroups((doc as { groups?: unknown } | null)?.groups);
  return groups.length > 0 ? groups : buildDefaultOrganizationGroups();
}

/** 활성 팀 이름 목록. 프로젝트 담당조직처럼 한 단계만 쓰는 화면이 이걸 쓴다. */
export function activeTeamLabels(groups: OrganizationGroup[]): string[] {
  return groups
    .filter((group) => group.active)
    .flatMap((group) => group.teams.filter((team) => team.active).map((team) => team.label));
}

/**
 * 화면에 보여줄 선택지. 목록에서 빠졌거나 비활성인 값이라도 지금 저장돼 있으면 남긴다 —
 * 드롭다운이 기존 값을 삼키면 저장하는 순간 소속이 조용히 바뀐다.
 */
export function optionsWithCurrentValue(options: string[], current: string): string[] {
  const value = current.trim();
  if (!value || options.includes(value)) return options;
  return [...options, value];
}

export function buildOrganizationSettingsDoc(input: {
  groups: OrganizationGroup[];
  actorId?: string;
  now?: string;
}): OrganizationSettingsDoc {
  return {
    version: 1,
    groups: normalizeOrganizationGroups(input.groups).map((group, groupIndex) => ({
      ...group,
      sortOrder: groupIndex,
      teams: group.teams.map((team, teamIndex) => ({ ...team, sortOrder: teamIndex })),
    })),
    updatedAt: input.now || new Date().toISOString(),
    updatedBy: input.actorId || 'system',
  };
}
