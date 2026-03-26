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

describe('navigation helpers', () => {
  it('classifies portal roles', () => {
    expect(isPortalRole('pm')).toBe(true);
    expect(isPortalRole('viewer')).toBe(true);
    expect(isPortalRole('admin')).toBe(false);
  });

  it('classifies admin space roles', () => {
    expect(isAdminSpaceRole('admin')).toBe(true);
    expect(isAdminSpaceRole('finance')).toBe(true);
    expect(isAdminSpaceRole('pm')).toBe(false);
  });

  it('normalizes role strings', () => {
    expect(resolveHomePath(' PM ')).toBe('/portal');
    expect(resolveHomePath('ADMIN')).toBe('/');
  });

  it('supports workspace-aware home resolution for admin accounts', () => {
    expect(resolveHomePath('admin', 'portal')).toBe('/portal');
    expect(resolveHomePath('admin', 'admin')).toBe('/');
  });

  it('defaults unknown roles to portal space (least privilege)', () => {
    expect(resolveHomePath('unknown_role')).toBe('/portal');
    expect(resolveHomePath('')).toBe('/portal');
    expect(resolveHomePath(null)).toBe('/portal');
  });

  it('knows which roles can enter or choose a workspace', () => {
    expect(canEnterPortalWorkspace('pm')).toBe(true);
    expect(canEnterPortalWorkspace('admin')).toBe(true);
    expect(canEnterPortalWorkspace('finance')).toBe(false);
    expect(canChooseWorkspace('admin')).toBe(true);
    expect(canChooseWorkspace('pm')).toBe(false);
  });

  it('prompts workspace selection only when admin has no preference', () => {
    expect(shouldPromptWorkspaceSelection('admin', undefined)).toBe(true);
    expect(shouldPromptWorkspaceSelection('admin', 'portal')).toBe(false);
    expect(shouldPromptWorkspaceSelection('pm', undefined)).toBe(false);
  });

  it('resolves post-login routes without leaking unauthorized paths', () => {
    expect(resolvePostLoginPath('pm', undefined, '/portal/weekly-expenses')).toBe('/portal/weekly-expenses');
    expect(resolvePostLoginPath('pm', undefined, '/settings')).toBe('/portal');
    expect(resolvePostLoginPath('admin', 'portal', '/settings')).toBe('/settings');
    expect(resolvePostLoginPath('admin', 'portal', '/portal/budget')).toBe('/portal/budget');
    expect(resolvePostLoginPath('finance', undefined, '/portal/weekly-expenses')).toBe('/');
  });

  it('forces onboarding only for unregistered portal users', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'pm',
      isRegistered: false,
      pathname: '/portal',
    })).toBe(true);

    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'viewer',
      isRegistered: false,
      pathname: '/portal/onboarding',
    })).toBe(false);

    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'pm',
      isRegistered: true,
      pathname: '/portal',
    })).toBe(false);
  });

  it('never forces onboarding for admin-space roles', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'admin',
      isRegistered: false,
      pathname: '/portal',
    })).toBe(false);

    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'finance',
      isRegistered: false,
      pathname: '/portal',
    })).toBe(false);
  });
});
