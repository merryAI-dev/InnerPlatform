import { describe, expect, it } from 'vitest';
import { resolveEffectiveAuthRole } from './auth-role-resolution';

describe('resolveEffectiveAuthRole', () => {
  it('keeps an explicit member role ahead of claims', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: 'pm',
      claimRole: 'admin',
    })).toBe('pm');
  });

  it('uses claim role when member role is missing', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: '',
      claimRole: 'finance',
    })).toBe('finance');
  });

  it('does not infer a privileged role when member and claim roles are missing', () => {
    expect(resolveEffectiveAuthRole({
      memberRole: '',
      claimRole: '',
    })).toBe('pm');
  });
});
