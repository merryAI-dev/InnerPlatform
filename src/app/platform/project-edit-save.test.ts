import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { buildPortalProjectEditSavePayload } from './project-edit-save';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    slug: 'project-1',
    orgId: 'org001',
    name: '기존 프로젝트',
    status: 'IN_PROGRESS',
    type: 'D1',
    phase: 'CONFIRMED',
    contractAmount: 100,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'TYPE1',
    basis: '공급가액',
    accountType: 'DEDICATED',
    paymentPlan: { contract: 0, interim: 0, final: 0 },
    paymentPlanDesc: '',
    clientOrg: 'MYSC',
    groupwareName: '',
    participantCondition: '',
    contractType: '계약서(날인)',
    department: 'CIC1',
    cic: 'CIC1',
    teamName: '',
    managerId: 'u001',
    managerName: '담당자',
    budgetCurrentYear: 100,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '',
    lastCheckedAt: '',
    cashflowDiffNote: '',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('project edit save payload', () => {
  it('uses the latest project version when the portal edit page has stale state', () => {
    const staleProject = project({ version: 1, department: 'CIC1', cic: 'CIC1' });
    const latestProject = project({ version: 5, department: 'CIC1', cic: 'CIC1', updatedAt: '2026-05-20T00:00:00.000Z' });

    const payload = buildPortalProjectEditSavePayload({
      baseProject: staleProject,
      latestProject,
      patch: { department: 'CIC2', cic: 'CIC2' },
      orgId: 'org001',
      updatedAt: '2026-05-20T01:00:00.000Z',
    });

    expect(payload.expectedVersion).toBe(5);
    expect(payload.project).toMatchObject({
      id: 'p-1',
      department: 'CIC2',
      cic: 'CIC2',
      version: 5,
      updatedAt: '2026-05-20T01:00:00.000Z',
    });
  });
});
