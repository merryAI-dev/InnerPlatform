import type { Project } from '../data/types';

function normalizeSearchValue(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function matchesProjectSearch(project: Project, query: string): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  const teamMemberFields = (project.teamMembersDetailed || []).flatMap((member) => [
    member.memberName,
    member.memberNickname,
    member.role,
  ]);
  const searchableFields = [
    project.id,
    project.name,
    project.officialContractName,
    project.groupwareName,
    project.clientOrg,
    project.department,
    project.managerName,
    project.registeredByName,
    project.type,
    ...teamMemberFields,
  ];

  return searchableFields.some((value) => normalizeSearchValue(value).includes(normalizedQuery));
}
