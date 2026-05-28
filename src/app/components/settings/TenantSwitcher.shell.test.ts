import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'TenantSwitcher.tsx'), 'utf8');

describe('TenantSwitcher redirect contract', () => {
  it('does not force root navigation after tenant selection', () => {
    expect(source).toContain('setOrgId(nextId)');
    expect(source).not.toContain("navigate('/', { replace: true })");
  });
});
