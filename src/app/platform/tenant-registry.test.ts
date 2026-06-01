import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_TENANT_REGISTRY, mergeTenantRegistryEntries } from './tenant-registry';

describe('tenant registry defaults', () => {
  it('keeps MYSC as a protected bootstrap organization', () => {
    expect(BOOTSTRAP_TENANT_REGISTRY).toContainEqual({
      id: 'mysc',
      name: 'MYSC',
      adminOrgId: 'mysc',
      protected: true,
      branding: {},
    });
  });

  it('merges firestore entries over bootstrap defaults', () => {
    expect(mergeTenantRegistryEntries('mysc', [{
      id: 'mysc',
      name: 'MYSC 수정',
      adminOrgId: 'mysc',
      protected: true,
    }])).toContainEqual({
      id: 'mysc',
      name: 'MYSC 수정',
      adminOrgId: 'mysc',
      protected: true,
      branding: {},
    });
  });

  it('adds the active org when it is not in the bootstrap list', () => {
    expect(mergeTenantRegistryEntries('partner-org', [])).toEqual([
      {
        id: 'mysc',
        name: 'MYSC',
        adminOrgId: 'mysc',
        protected: true,
        branding: {},
      },
      {
        id: 'partner-org',
        name: 'partner-org',
        adminOrgId: 'partner-org',
        protected: true,
        branding: {},
      },
    ]);
  });
});
