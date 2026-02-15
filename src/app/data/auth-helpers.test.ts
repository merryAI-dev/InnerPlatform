import { describe, expect, it } from 'vitest';
import {
  isPrivilegedRole,
  normalizeEmail,
  resolveProjectIdForManager,
  resolveRoleFromDirectory,
} from './auth-helpers';

describe('auth-helpers', () => {
  it('normalizes emails before lookup', () => {
    const role = resolveRoleFromDirectory(' ADMIN@MYSC.CO.KR ', [
      { uid: 'u001', email: 'admin@mysc.co.kr', role: 'admin' },
    ]);
    expect(role).toBe('admin');
    expect(normalizeEmail(' Test@Email.COM ')).toBe('test@email.com');
  });

  it('falls back to viewer role when no directory match exists', () => {
    const role = resolveRoleFromDirectory('unknown@mysc.co.kr', []);
    expect(role).toBe('viewer');
  });

  it('resolves manager project ownership', () => {
    const projectId = resolveProjectIdForManager('u002', [
      { id: 'p001', managerId: 'u001' },
      { id: 'p002', managerId: 'u002' },
    ]);
    expect(projectId).toBe('p002');
  });

  it('classifies privileged roles', () => {
    expect(isPrivilegedRole('admin')).toBe(true);
    expect(isPrivilegedRole('finance')).toBe(true);
    expect(isPrivilegedRole('auditor')).toBe(true);
    expect(isPrivilegedRole('pm')).toBe(false);
  });
});
