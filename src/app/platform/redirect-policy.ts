export type SystemRedirectReason =
  | 'unauthenticated-login'
  | 'post-login-success'
  | 'preview-auth-fallback';

const STATE_DRIVEN_REDIRECT_REASONS = new Set([
  'role-missing',
  'role-denied',
  'workspace-missing',
  'tenant-changed',
  'portal-user-missing',
  'active-project-missing',
  'project-status-changed',
]);

export function isSystemRedirectAllowed(reason: SystemRedirectReason): boolean {
  return reason === 'unauthenticated-login'
    || reason === 'post-login-success'
    || reason === 'preview-auth-fallback';
}

export function isStateDrivenRedirectForbidden(reason: string): boolean {
  return STATE_DRIVEN_REDIRECT_REASONS.has(reason);
}
