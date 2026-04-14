import { describe, expect, it } from 'vitest';
import {
  canChooseWorkspace,
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  isPortalRole,
  normalizeRequestedPath,
  resolveActiveWorkspacePreference,
  resolvePortalEntryPath,
  resolveHomePath,
  resolveRequestedRedirectPath,
  resolvePostLoginPath,
  shouldPromptWorkspaceSelection,
  shouldForcePortalOnboarding,
} from './navigation';

const ALL_ROLES = ['admin', 'finance', 'pm', 'viewer'] as const;

describe('role classification', () => {
  it('isPortalRole: pm and viewer only', () => {
    expect(isPortalRole('pm')).toBe(true);
    expect(isPortalRole('viewer')).toBe(true);
    expect(isPortalRole('admin')).toBe(false);
    expect(isPortalRole('finance')).toBe(false);
    expect(isPortalRole('')).toBe(false);
    expect(isPortalRole(null)).toBe(false);
    expect(isPortalRole(undefined)).toBe(false);
  });

  it('isAdminSpaceRole: admin and finance only', () => {
    expect(isAdminSpaceRole('admin')).toBe(true);
    expect(isAdminSpaceRole('finance')).toBe(true);
    expect(isAdminSpaceRole('pm')).toBe(false);
    expect(isAdminSpaceRole('viewer')).toBe(false);
    expect(isAdminSpaceRole('')).toBe(false);
    expect(isAdminSpaceRole(null)).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    expect(isPortalRole(' PM ')).toBe(true);
    expect(isPortalRole('VIEWER')).toBe(true);
    expect(isAdminSpaceRole('ADMIN')).toBe(true);
    expect(isAdminSpaceRole(' Finance ')).toBe(true);
  });
});

describe('workspace selection', () => {
  it('only roles that can genuinely access both spaces can choose workspace', () => {
    expect(canChooseWorkspace('admin')).toBe(true);
    expect(canChooseWorkspace('finance')).toBe(true);
    expect(canChooseWorkspace('pm')).toBe(false);
    expect(canChooseWorkspace('viewer')).toBe(false);
  });

  it('empty/null/undefined cannot choose workspace', () => {
    expect(canChooseWorkspace('')).toBe(false);
    expect(canChooseWorkspace(null)).toBe(false);
    expect(canChooseWorkspace(undefined)).toBe(false);
  });

  it('all valid roles can enter portal workspace', () => {
    for (const role of ALL_ROLES) {
      expect(canEnterPortalWorkspace(role), `${role} should enter portal`).toBe(true);
    }
  });

  it('empty role cannot enter portal workspace', () => {
    expect(canEnterPortalWorkspace('')).toBe(false);
  });
});

describe('shouldPromptWorkspaceSelection', () => {
  it('prompts only when a dual-space role has no preferred workspace yet', () => {
    expect(shouldPromptWorkspaceSelection('admin', undefined)).toBe(true);
    expect(shouldPromptWorkspaceSelection('finance', undefined)).toBe(true);
    expect(shouldPromptWorkspaceSelection('admin', 'portal')).toBe(false);
    expect(shouldPromptWorkspaceSelection('finance', 'admin')).toBe(false);
    expect(shouldPromptWorkspaceSelection('pm', undefined)).toBe(false);
    expect(shouldPromptWorkspaceSelection('viewer', undefined)).toBe(false);
  });

  it('does NOT prompt for empty role', () => {
    expect(shouldPromptWorkspaceSelection('', undefined)).toBe(false);
    expect(shouldPromptWorkspaceSelection(null, 'admin')).toBe(false);
  });
});

describe('resolveActiveWorkspacePreference', () => {
  it('prefers the last workspace for current-session routing', () => {
    expect(resolveActiveWorkspacePreference('admin', 'portal')).toBe('admin');
    expect(resolveActiveWorkspacePreference('portal', 'admin')).toBe('portal');
  });

  it('falls back to default workspace when no last workspace exists', () => {
    expect(resolveActiveWorkspacePreference(undefined, 'portal')).toBe('portal');
    expect(resolveActiveWorkspacePreference(undefined, 'admin')).toBe('admin');
  });

  it('ignores invalid workspace values', () => {
    expect(resolveActiveWorkspacePreference('invalid', 'portal')).toBe('portal');
    expect(resolveActiveWorkspacePreference(null, '')).toBeUndefined();
  });
});

describe('resolveHomePath', () => {
  it('admin defaults to /', () => {
    expect(resolveHomePath('admin')).toBe('/');
    expect(resolveHomePath('admin', 'admin')).toBe('/');
  });

  it('admin with portal preference goes to /portal', () => {
    expect(resolveHomePath('admin', 'portal')).toBe('/portal');
  });

  it('finance defaults to /', () => {
    expect(resolveHomePath('finance')).toBe('/');
  });

  it('pm and viewer default to /portal', () => {
    expect(resolveHomePath('pm')).toBe('/portal');
    expect(resolveHomePath('viewer')).toBe('/portal');
  });

  it('unknown roles default to /portal', () => {
    expect(resolveHomePath('unknown_role')).toBe('/portal');
    expect(resolveHomePath('')).toBe('/portal');
    expect(resolveHomePath(null)).toBe('/portal');
  });

  it('normalizes role casing', () => {
    expect(resolveHomePath(' PM ')).toBe('/portal');
    expect(resolveHomePath('ADMIN')).toBe('/');
    expect(resolveHomePath('FINANCE')).toBe('/');
  });
});

describe('resolvePostLoginPath', () => {
  // ── portal paths ──
  it('pm can access portal paths', () => {
    expect(resolvePostLoginPath('pm', undefined, '/portal/weekly-expenses')).toBe('/portal/weekly-expenses');
    expect(resolvePostLoginPath('pm', undefined, '/portal/budget')).toBe('/portal/budget');
    expect(resolvePostLoginPath('pm', undefined, '/portal')).toBe('/portal');
  });

  it('admin can access portal paths', () => {
    expect(resolvePostLoginPath('admin', 'portal', '/portal/budget')).toBe('/portal/budget');
  });

  it('finance can access portal paths', () => {
    expect(resolvePostLoginPath('finance', undefined, '/portal/weekly-expenses')).toBe('/portal/weekly-expenses');
  });

  // ── admin paths ──
  it('admin can access admin paths', () => {
    expect(resolvePostLoginPath('admin', 'admin', '/settings')).toBe('/settings');
    expect(resolvePostLoginPath('admin', 'admin', '/users')).toBe('/users');
  });

  it('finance can access finance-allowed admin paths', () => {
    expect(resolvePostLoginPath('finance', undefined, '/cashflow')).toBe('/cashflow');
    expect(resolvePostLoginPath('finance', undefined, '/approvals')).toBe('/approvals');
  });

  it('finance falls back for admin-only paths outside its route permissions', () => {
    expect(resolvePostLoginPath('finance', undefined, '/audit')).toBe('/');
    expect(resolvePostLoginPath('finance', undefined, '/users')).toBe('/');
    expect(resolvePostLoginPath('finance', undefined, '/settings')).toBe('/');
  });

  it('pm falls back to portal for admin-only paths', () => {
    expect(resolvePostLoginPath('pm', undefined, '/approvals')).toBe('/portal');
    expect(resolvePostLoginPath('pm', undefined, '/settings')).toBe('/portal');
    expect(resolvePostLoginPath('pm', undefined, '/users')).toBe('/portal');
  });

  it('viewer falls back to portal for admin-only paths', () => {
    expect(resolvePostLoginPath('viewer', undefined, '/settings')).toBe('/portal');
    expect(resolvePostLoginPath('viewer', undefined, '/users')).toBe('/portal');
  });

  // ── special paths ──
  it('login/workspace-select paths are ignored (fallback)', () => {
    expect(resolvePostLoginPath('admin', 'admin', '/login')).toBe('/');
    expect(resolvePostLoginPath('admin', 'admin', '/workspace-select')).toBe('/');
  });

  it('no requestedPath → fallback home', () => {
    expect(resolvePostLoginPath('admin', 'admin')).toBe('/');
    expect(resolvePostLoginPath('pm', undefined)).toBe('/portal');
    expect(resolvePostLoginPath('admin', 'portal')).toBe('/portal');
  });

  it('non-string requestedPath → fallback', () => {
    expect(resolvePostLoginPath('admin', 'admin', null)).toBe('/');
    expect(resolvePostLoginPath('admin', 'admin', 123)).toBe('/');
  });

  it('relative path (no leading /) → fallback', () => {
    expect(resolvePostLoginPath('admin', 'admin', 'settings')).toBe('/');
  });

  it('empty role requesting portal path → fallback (canEnterPortalWorkspace false)', () => {
    expect(resolvePostLoginPath('', undefined, '/portal/budget')).toBe('/portal');
  });
});

describe('resolvePortalEntryPath', () => {
  it('routes portal logins through project-select while preserving the requested portal path', () => {
    expect(resolvePortalEntryPath('pm', undefined, '/portal/budget')).toBe('/portal/project-select?redirect=%2Fportal%2Fbudget');
    expect(resolvePortalEntryPath('admin', 'portal', '/portal/cashflow')).toBe('/portal/project-select?redirect=%2Fportal%2Fcashflow');
    expect(resolvePortalEntryPath('admin', 'admin', '/settings')).toBe('/settings');
  });
});

describe('requested redirect restoration', () => {
  it('normalizes requested path values', () => {
    expect(normalizeRequestedPath('/users')).toBe('/users');
    expect(normalizeRequestedPath('/login')).toBe('');
    expect(normalizeRequestedPath('/workspace-select')).toBe('');
    expect(normalizeRequestedPath('https://example.com/users')).toBe('');
  });

  it('prefers location.state.from when present', () => {
    expect(resolveRequestedRedirectPath('/users', '?redirect=%2Fsettings')).toBe('/users');
  });

  it('falls back to redirect query when state is empty', () => {
    expect(resolveRequestedRedirectPath(undefined, '?redirect=%2Fusers%3Ftab%3Dmembers')).toBe('/users?tab=members');
  });

  it('ignores invalid redirect query', () => {
    expect(resolveRequestedRedirectPath(undefined, '?redirect=https://evil.example.com')).toBe('');
  });
});

describe('shouldForcePortalOnboarding', () => {
  it('forces unregistered pm into onboarding', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: 'pm', isRegistered: false, pathname: '/portal',
    })).toBe(true);
  });

  it('forces unregistered viewer into onboarding', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: 'viewer', isRegistered: false, pathname: '/portal/budget',
    })).toBe(true);
  });

  it('does NOT force on bypass paths (onboarding, project-settings, project-select, weekly-expenses)', () => {
    const bypassPaths = ['/portal/onboarding', '/portal/project-settings', '/portal/project-select', '/portal/register-project', '/portal/weekly-expenses'];
    for (const pathname of bypassPaths) {
      expect(shouldForcePortalOnboarding({
        isAuthenticated: true, role: 'pm', isRegistered: false, pathname,
      }), `pm on ${pathname}`).toBe(false);
      expect(shouldForcePortalOnboarding({
        isAuthenticated: true, role: 'viewer', isRegistered: false, pathname,
      }), `viewer on ${pathname}`).toBe(false);
    }
  });

  it('does NOT force if registered', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: 'pm', isRegistered: true, pathname: '/portal',
    })).toBe(false);
  });

  it('does NOT force for admin-space roles (admin, finance)', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: 'admin', isRegistered: false, pathname: '/portal',
    })).toBe(false);
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: 'finance', isRegistered: false, pathname: '/portal',
    })).toBe(false);
  });

  it('does NOT force if not authenticated', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: false, role: 'pm', isRegistered: false, pathname: '/portal',
    })).toBe(false);
  });

  it('does NOT force for empty/null role', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: '', isRegistered: false, pathname: '/portal',
    })).toBe(false);
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true, role: null, isRegistered: false, pathname: '/portal',
    })).toBe(false);
  });
});
