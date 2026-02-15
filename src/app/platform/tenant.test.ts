import { describe, expect, it } from 'vitest';
import {
  assertTenantId,
  buildTenantScopedPath,
  isValidTenantId,
  resolveTenantId,
} from './tenant';

describe('tenant helpers', () => {
  it('validates tenant ids', () => {
    expect(isValidTenantId('mysc')).toBe(true);
    expect(isValidTenantId('my-org-01')).toBe(true);
    expect(isValidTenantId('MYSC')).toBe(true);
    expect(isValidTenantId('')).toBe(false);
    expect(isValidTenantId('org with space')).toBe(false);
    expect(isValidTenantId('org/child')).toBe(false);
  });

  it('asserts tenant ids', () => {
    expect(assertTenantId('MYSC')).toBe('mysc');
    expect(() => assertTenantId('invalid/tenant')).toThrow(/Invalid tenant id/);
  });

  it('resolves claim over saved and env values', () => {
    const resolved = resolveTenantId({
      claimTenantId: 'tenant-claim',
      savedTenantId: 'tenant-saved',
      envTenantId: 'tenant-env',
    });
    expect(resolved).toBe('tenant-claim');
  });

  it('falls back when strict mode is disabled', () => {
    const resolved = resolveTenantId({
      claimTenantId: 'invalid claim',
      savedTenantId: 'invalid/saved',
      envTenantId: 'env-ok',
      strict: false,
    });
    expect(resolved).toBe('env-ok');
  });

  it('throws on invalid candidate in strict mode', () => {
    expect(() => resolveTenantId({ claimTenantId: 'bad id', strict: true })).toThrow(
      /Invalid tenant id candidate/,
    );
  });

  it('builds tenant scoped paths safely', () => {
    expect(buildTenantScopedPath('mysc', 'projects', 'p001')).toBe('orgs/mysc/projects/p001');
    expect(() => buildTenantScopedPath('mysc', 'projects/child')).toThrow(/Invalid path segment/);
    expect(() => buildTenantScopedPath('mysc', '.')).toThrow(/Invalid path segment/);
    expect(() => buildTenantScopedPath('mysc', '..')).toThrow(/Invalid path segment/);
  });
});
