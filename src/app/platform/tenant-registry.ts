export interface TenantRegistryEntry {
  id: string;
  name: string;
  adminOrgId?: string;
  createdAt?: string;
  protected?: boolean;
  branding?: { primaryColor?: string; logoUrl?: string };
}

export const BOOTSTRAP_TENANT_REGISTRY: TenantRegistryEntry[] = [
  {
    id: 'mysc',
    name: 'MYSC',
    adminOrgId: 'mysc',
    protected: true,
    branding: {},
  },
];

export function mergeTenantRegistryEntries(
  activeOrgId: string,
  entries: TenantRegistryEntry[],
): TenantRegistryEntry[] {
  const byId = new Map<string, TenantRegistryEntry>();

  for (const entry of BOOTSTRAP_TENANT_REGISTRY) {
    byId.set(entry.id, entry);
  }

  const normalizedActiveOrgId = activeOrgId.trim().toLowerCase();
  if (normalizedActiveOrgId && !byId.has(normalizedActiveOrgId)) {
    byId.set(normalizedActiveOrgId, {
      id: normalizedActiveOrgId,
      name: normalizedActiveOrgId,
      adminOrgId: normalizedActiveOrgId,
      protected: true,
      branding: {},
    });
  }

  for (const entry of entries) {
    byId.set(entry.id, {
      ...byId.get(entry.id),
      ...entry,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
