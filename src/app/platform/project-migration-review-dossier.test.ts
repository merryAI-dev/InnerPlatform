import { describe, expect, it } from 'vitest';
import { buildMigrationReviewDossier } from './project-migration-review-dossier';
import type { Project, ProjectRequest } from '../data/types';

const project: Project = {
  id: 'p-1',
  slug: 'p-1',
  orgId: 'mysc',
  registrationSource: 'pm_portal',
  name: '2026 다자간협력',
  officialContractName: '2026 다자간협력 프로그램',
  status: 'CONTRACT_PENDING',
  type: 'D1',
  phase: 'CONFIRMED',
  contractAmount: 120000000,
  contractStart: '2026-01-01',
  contractEnd: '2026-12-31',
  settlementType: 'TYPE1',
  basis: '공급가액',
  accountType: 'NONE',
  fundInputMode: 'DIRECT_ENTRY',
  paymentPlan: { contract: 40, interim: 30, final: 30 },
  paymentPlanDesc: '선금 40%, 중도금 30%, 잔금 30%',
  clientOrg: 'KOICA',
  groupwareName: '2026 다자간협력 운영',
  participantCondition: '현지 파트너 공동참여',
  teamMembersDetailed: [
    { memberName: '변민욱', memberNickname: '보람', role: 'PM', participationRate: 60 },
    { memberName: '김다은', memberNickname: '데이나', role: '운영', participationRate: 40 },
  ],
  contractType: '계약서(날인)',
  projectPurpose: '다자간협력 사업 운영 및 성과 확산',
  department: 'CIC1',
  teamName: '임팩트 CIC',
  managerId: 'u-1',
  managerName: '변민욱',
  budgetCurrentYear: 120000000,
  taxInvoiceAmount: 0,
  profitRate: 0.18,
  profitAmount: 21600000,
  isSettled: false,
  finalPaymentNote: '',
  confirmerName: '센터장A',
  lastCheckedAt: '2026-04-20T09:00:00Z',
  cashflowDiffNote: '',
  createdAt: '2026-04-01T09:00:00Z',
  updatedAt: '2026-04-20T09:00:00Z',
  salesVatAmount: 10000000,
};

const request: ProjectRequest = {
  id: 'pr-1',
  tenantId: 'mysc',
  status: 'APPROVED',
  reviewOutcome: 'APPROVED',
  requestedBy: 'u-1',
  requestedByName: '변민욱',
  requestedByEmail: 'pm@example.com',
  requestedAt: '2026-04-20T08:00:00Z',
  reviewedBy: 'u-admin',
  reviewedByName: '임원A',
  reviewedAt: '2026-04-20T10:00:00Z',
  reviewComment: '승인',
  approvedProjectId: 'p-1',
  payload: {
    name: '2026 다자간협력',
    officialContractName: '2026 다자간협력 프로그램',
    type: 'D1',
    description: '다자간협력 사업 설명',
    clientOrg: 'KOICA',
    department: 'CIC1',
    contractAmount: 120000000,
    salesVatAmount: 10000000,
    totalRevenueAmount: 120000000,
    supportAmount: 0,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'NONE',
    fundInputMode: 'DIRECT_ENTRY',
    settlementSheetPolicy: project.settlementSheetPolicy,
    paymentPlanDesc: '선금 40%, 중도금 30%, 잔금 30%',
    settlementGuide: '정산 가이드',
    projectPurpose: '다자간협력 사업 운영 및 성과 확산',
    managerName: '변민욱',
    teamName: '임팩트 CIC',
    teamMembers: '변민욱(보람), 김다은(데이나)',
    teamMembersDetailed: project.teamMembersDetailed,
    participantCondition: '현지 파트너 공동참여',
    note: '임원 검토 메모 없음',
    contractDocument: null,
    contractAnalysis: null,
  },
};

describe('buildMigrationReviewDossier', () => {
  it('builds an executive review dossier from the PM portal project and request payload', () => {
    const dossier = buildMigrationReviewDossier(project, request);

    expect(dossier.headerTitle).toBe('2026 다자간협력');
    expect(dossier.identity.clientOrg).toBe('KOICA');
    expect(dossier.identity.cic).toBe('CIC1');
    expect(dossier.identity.pmName).toBe('변민욱');

    expect(dossier.contract.projectTypeLabel).toBeTruthy();
    expect(dossier.contract.periodLabel).toContain('2026-01-01');
    expect(dossier.contract.basisLabel).toBe('공급가액 기준');
    expect(dossier.contract.accountTypeLabel).toBe('일반 사업');
    expect(dossier.contract.fundInputModeLabel).toBe('직접 입력');

    expect(dossier.budget.contractAmountLabel).toContain('120,000,000');
    expect(dossier.budget.salesVatAmountLabel).toContain('10,000,000');
    expect(dossier.people.teamName).toBe('임팩트 CIC');
    expect(dossier.people.members[0]).toContain('변민욱');
    expect(dossier.people.members[0]).toContain('PM');

    expect(dossier.notes.projectPurpose).toContain('성과 확산');
    expect(dossier.notes.participantCondition).toContain('공동참여');
    expect(dossier.audit.requestedByName).toBe('변민욱');
    expect(dossier.audit.reviewedByName).toBe('임원A');
    expect(dossier.analysis.summary).toBe('-');
  });

  it('falls back to project fields even when no project request document is attached', () => {
    const dossier = buildMigrationReviewDossier(project, null);

    expect(dossier.headerTitle).toBe('2026 다자간협력');
    expect(dossier.identity.clientOrg).toBe('KOICA');
    expect(dossier.identity.cic).toBe('CIC1');
    expect(dossier.identity.pmName).toBe('변민욱');
    expect(dossier.contract.accountTypeLabel).toBe('일반 사업');
    expect(dossier.people.members[0]).toContain('변민욱');
    expect(dossier.audit.requestedByName).toBe('-');
    expect(dossier.audit.reviewedByName).toBe('-');
  });
});
