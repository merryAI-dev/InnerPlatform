import { describe, expect, it } from 'vitest';
import {
  canChooseWorkspace,
  canEnterPortalWorkspace,
  isAdminSpaceRole,
  isPortalRole,
  resolveHomePath,
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
    expect(isAdminSpaceRole('security')).toBe(true);
    expect(isAdminSpaceRole('pm')).toBe(false);
  });

  it('normalizes role strings', () => {
    expect(resolveHomePath(' PM ')).toBe('/portal');
    expect(resolveHomePath('ADMIN')).toBe('/');
    expect(resolveHomePath('admin', 'portal')).toBe('/portal');
  });

  it('defaults unknown roles to portal space (least privilege)', () => {
    expect(resolveHomePath('unknown_role')).toBe('/portal');
    expect(resolveHomePath('')).toBe('/portal');
    expect(resolveHomePath(null)).toBe('/portal');
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
      role: 'pm',
      isRegistered: true,
      pathname: '/portal',
    })).toBe(false);

    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'admin',
      isRegistered: false,
      pathname: '/portal',
    })).toBe(true);
  });

  it('never forces onboarding for roles outside portal workspace', () => {
    expect(shouldForcePortalOnboarding({
      isAuthenticated: true,
      role: 'finance',
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

  it('exposes workspace chooser only for admin roles', () => {
    expect(canChooseWorkspace('admin')).toBe(true);
    expect(canChooseWorkspace('tenant_admin')).toBe(true);
    expect(canChooseWorkspace('finance')).toBe(false);
    expect(shouldPromptWorkspaceSelection('admin', undefined)).toBe(true);
    expect(shouldPromptWorkspaceSelection('admin', 'portal')).toBe(false);
  });

  it('distinguishes portal-capable roles', () => {
    expect(canEnterPortalWorkspace('pm')).toBe(true);
    expect(canEnterPortalWorkspace('admin')).toBe(true);
    expect(canEnterPortalWorkspace('finance')).toBe(false);
  });
});
