import { describe, expect, it } from 'vitest';
import {
  canChooseWorkspace,
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  isPortalRole,
  resolveHomePath,
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
  it('all valid roles can choose workspace', () => {
    for (const role of ALL_ROLES) {
      expect(canChooseWorkspace(role), `${role} should choose workspace`).toBe(true);
    }
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
  it('always prompts for valid roles (매번 workspace 선택)', () => {
    for (const role of ALL_ROLES) {
      expect(shouldPromptWorkspaceSelection(role, undefined), `${role} no pref`).toBe(true);
      expect(shouldPromptWorkspaceSelection(role, 'portal'), `${role} portal`).toBe(true);
      expect(shouldPromptWorkspaceSelection(role, 'admin'), `${role} admin`).toBe(true);
    }
  });

  it('does NOT prompt for empty role', () => {
    expect(shouldPromptWorkspaceSelection('', undefined)).toBe(false);
    expect(shouldPromptWorkspaceSelection(null, 'admin')).toBe(false);
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

  it('finance can temporarily access admin paths while admin is open to all', () => {
    expect(resolvePostLoginPath('finance', undefined, '/users')).toBe('/users');
    expect(resolvePostLoginPath('finance', undefined, '/settings')).toBe('/settings');
  });

  it('pm can temporarily access admin paths while admin is open to all', () => {
    expect(resolvePostLoginPath('pm', undefined, '/settings')).toBe('/settings');
    expect(resolvePostLoginPath('pm', undefined, '/users')).toBe('/users');
  });

  it('viewer can temporarily access admin paths while admin is open to all', () => {
    expect(resolvePostLoginPath('viewer', undefined, '/settings')).toBe('/settings');
    expect(resolvePostLoginPath('viewer', undefined, '/users')).toBe('/users');
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

  it('does NOT force on bypass paths (onboarding, project-settings, weekly-expenses)', () => {
    const bypassPaths = ['/portal/onboarding', '/portal/project-settings', '/portal/register-project', '/portal/weekly-expenses'];
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
