export function buildParticipationDashboardAuthScopeKey(
  orgId: string,
  actor: { uid: string; role: string } | null,
): string {
  return JSON.stringify([orgId, actor?.uid || '', actor?.role || '']);
}
