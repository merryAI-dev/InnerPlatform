export function normalizeProjectIds(values: Array<string | null | undefined>): string[] {
  const normalized = values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

export function resolvePrimaryProjectId(
  projectIds: string[],
  preferredProjectId?: string,
): string | undefined {
  if (!projectIds.length) return undefined;
  if (preferredProjectId && projectIds.includes(preferredProjectId)) return preferredProjectId;
  return projectIds[0];
}

export function includesProject(projectIds: string[], projectId: string): boolean {
  const target = projectId.trim();
  if (!target) return false;
  return projectIds.includes(target);
}
