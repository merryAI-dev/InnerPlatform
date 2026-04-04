const RECENT_PORTAL_PROJECTS_KEY = 'mysc-portal-recent-projects';
const RECENT_PORTAL_PROJECTS_LIMIT = 5;

export function readRecentPortalProjectIds(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_PORTAL_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, RECENT_PORTAL_PROJECTS_LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecentPortalProject(projectId: string): void {
  const normalized = String(projectId || '').trim();
  if (!normalized || typeof localStorage === 'undefined') return;
  try {
    const next = [
      normalized,
      ...readRecentPortalProjectIds().filter((value) => value !== normalized),
    ].slice(0, RECENT_PORTAL_PROJECTS_LIMIT);
    localStorage.setItem(RECENT_PORTAL_PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // ignore localStorage failures
  }
}
