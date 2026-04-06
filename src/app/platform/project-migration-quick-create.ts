import { createSettlementSheetPolicy, type Project, type ProjectStatus } from '../data/types';
import type { ProjectMigrationCandidate } from '../data/project-migration-candidates';

interface BuildQuickMigrationProjectInput {
  orgId: string;
  candidate: ProjectMigrationCandidate;
  name: string;
  cic: string;
  actor: {
    uid: string;
    name: string;
  };
  now?: string;
}

function slugify(raw: string): string {
  const normalized = String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return normalized || 'project';
}

function buildProjectId(): string {
  const nonce = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `p_${Date.now().toString(36)}_${nonce}`;
}

function normalizeCic(value: string): string | undefined {
  const normalized = String(value || '').trim();
  return normalized && normalized !== '미지정' ? normalized : undefined;
}

function resolveAccountType(label: string): Project['accountType'] {
  const normalized = String(label || '').trim();
  if (normalized.includes('전용')) return 'DEDICATED';
  if (normalized.includes('운영')) return 'OPERATING';
  return 'NONE';
}

export function buildQuickMigrationProject(input: BuildQuickMigrationProjectInput): Project {
  const now = input.now || new Date().toISOString();
  const today = now.slice(0, 10);
  const id = buildProjectId();
  const name = String(input.name || '').trim();
  const officialContractName = String(input.candidate.businessName || '').trim() || name;
  const cic = normalizeCic(input.cic);

  return {
    id,
    slug: `${slugify(name)}-${id.slice(-6)}`,
    orgId: input.orgId,
    ...(cic ? { cic } : {}),
    registrationSource: 'migration_audit_quick_create',
    name,
    shortName: name,
    officialContractName,
    status: 'CONTRACT_PENDING' satisfies ProjectStatus,
    type: 'D1',
    phase: 'CONFIRMED',
    contractAmount: 0,
    contractStart: today,
    contractEnd: today,
    settlementType: 'NONE',
    basis: 'NONE',
    accountType: resolveAccountType(input.candidate.accountLabel),
    fundInputMode: 'BANK_UPLOAD',
    settlementSheetPolicy: createSettlementSheetPolicy('STANDARD'),
    paymentPlan: {
      contract: 0,
      interim: 0,
      final: 0,
    },
    paymentPlanDesc: '',
    clientOrg: String(input.candidate.clientOrg || '').trim(),
    groupwareName: String(input.candidate.groupwareProjectName || '').trim(),
    participantCondition: '',
    contractType: '계약서(날인)',
    department: String(input.candidate.department || '').trim(),
    teamName: String(input.candidate.department || '').trim(),
    managerId: input.actor.uid,
    managerName: input.actor.name,
    budgetCurrentYear: 0,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: input.actor.name,
    lastCheckedAt: now,
    cashflowDiffNote: '',
    createdAt: now,
    updatedAt: now,
  };
}
