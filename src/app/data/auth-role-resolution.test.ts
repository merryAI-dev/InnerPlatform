import { describe, expect, it } from 'vitest';
import { resolveEffectiveAuthRole } from './auth-role-resolution';

describe('resolveEffectiveAuthRole', () => {
  it('keeps an explicit member role ahead of bootstrap admin and claims', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: 'pm',
      claimRole: 'admin',
      directoryRole: 'finance',
      bootstrapAdmin: true,
    })).toBe('pm');
  });

  it('uses claim role when member role is missing', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: '',
      claimRole: 'finance',
      directoryRole: 'pm',
      bootstrapAdmin: false,
    })).toBe('finance');
  });

  it('uses bootstrap admin only as a fallback for missing member and claim roles', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: '',
      claimRole: '',
      directoryRole: 'pm',
      bootstrapAdmin: true,
    })).toBe('admin');
  });
});
