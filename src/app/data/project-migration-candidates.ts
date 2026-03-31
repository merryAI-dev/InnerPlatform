export interface ProjectMigrationCandidate {
  id: string;
  department: string;
  coreMembers: string;
  groupwareProjectName: string;
  accountLabel: string;
  businessName: string;
  clientOrg: string;
  tenantId?: string;
  sourceRow?: number;
  createdAt?: string;
  updatedAt?: string;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeProjectMigrationCandidate(
  id: string,
  raw: Record<string, unknown>,
): ProjectMigrationCandidate {
  return {
    id,
    department: readString(raw.department),
    coreMembers: readString(raw.coreMembers),
    groupwareProjectName: readString(raw.groupwareProjectName),
    accountLabel: readString(raw.accountLabel),
    businessName: readString(raw.businessName),
    clientOrg: readString(raw.clientOrg),
    tenantId: readString(raw.tenantId) || undefined,
    sourceRow: readNumber(raw.sourceRow),
    createdAt: readString(raw.createdAt) || undefined,
    updatedAt: readString(raw.updatedAt) || undefined,
  };
}
