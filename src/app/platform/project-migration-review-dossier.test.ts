import { describe, expect, it } from 'vitest';
import { buildMigrationReviewDossier } from './project-migration-review-dossier';
import type { Project } from '../data/types';
import type { MigrationAuditConsoleRecord } from './project-migration-console';

const record: MigrationAuditConsoleRecord = {
  id: 'cand-1',
  candidate: {
    id: 'cand-1',
    businessName: '2026 다자간협력',
    clientOrg: 'KOICA',
    department: 'CIC1',
    coreMembers: '홍길동, 김영희',
    groupwareProjectName: '2026 다자간협력 운영',
    accountLabel: '운영통장',
  },
  status: 'CANDIDATE',
  cic: 'CIC1',
  sourceName: '2026 다자간협력',
  sourceDepartment: 'CIC1',
  sourceClientOrg: 'KOICA',
  match: null,
  matchLabel: '등록 필요',
  nextActionLabel: '후보 검토 후 연결',
};

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

describe('buildMigrationReviewDossier', () => {
  it('builds an executive review dossier with project edit, budget, and staffing sections', () => {
    const dossier = buildMigrationReviewDossier(record, project);

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
  });

  it('falls back to PM candidate information when no registered project exists yet', () => {
    const dossier = buildMigrationReviewDossier(record, null);

    expect(dossier.headerTitle).toBe('2026 다자간협력');
    expect(dossier.identity.clientOrg).toBe('KOICA');
    expect(dossier.identity.cic).toBe('CIC1');
    expect(dossier.identity.pmName).toContain('홍길동');
    expect(dossier.identity.officialContractName).toBe('2026 다자간협력 운영');
    expect(dossier.contract.accountTypeLabel).toBe('운영통장');
    expect(dossier.people.members[0]).toContain('홍길동');
    expect(dossier.notes.projectPurpose).toBe('-');
  });
});
