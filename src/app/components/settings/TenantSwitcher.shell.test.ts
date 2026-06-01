import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'TenantSwitcher.tsx'), 'utf8');

describe('TenantSwitcher redirect contract', () => {
  it('does not force root navigation after tenant selection', () => {
    expect(source).toContain('setOrgId(nextId)');
    expect(source).not.toContain("navigate('/', { replace: true })");
  });

  it('keeps new tenant registration wired to the tenant ledger tab', () => {
    expect(source).toContain("navigate('/settings?tab=tenants')");
    expect(source).toContain('신규 조직 등록');
  });
});
