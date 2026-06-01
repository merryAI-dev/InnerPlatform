import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'TenantManagementTab.tsx'), 'utf8');

describe('TenantManagementTab shell contract', () => {
  it('scopes organization DB entries to the active admin org without hard-coded org ids', () => {
    expect(source).toContain("collection(db, 'orgs', orgId, 'tenant_registry')");
    expect(source).not.toContain("collection(db, 'tenants')");
    expect(source).toContain('mergeTenantRegistryEntries(adminOrgId');
    expect(source).toContain("where('adminOrgId', '==', adminOrgId)");
    expect(source).toContain('adminOrgId,');
    expect(source).not.toContain("id === 'mysc'");
    expect(source).not.toContain('mysc 기본 조직');
  });
});
