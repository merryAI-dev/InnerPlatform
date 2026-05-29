import { describe, expect, it } from 'vitest';
import type { Project } from '../data/types';
import { createProjectEditorDraft } from './project-editor';
import {
  buildProjectChangeRequest,
  buildProjectPatchFromRequestPayload,
  resolveProjectRequestKind,
} from './project-change-request';

const baseProject = {
  id: 'p-cts2',
  version: 7,
  slug: 'cts2',
  orgId: 'mysc',
  name: '2026 CTS2',
  officialContractName: 'CTS2 원본',
  status: 'IN_PROGRESS',
  type: 'D1',
  phase: 'CONFIRMED',
  contractAmount: 1000,
  contractStart: '2026-01-01',
  contractEnd: '2026-12-31',
  settlementType: 'TYPE1',
  basis: '공급가액',
  accountType: 'OPERATING',
  paymentPlan: { contract: 0, interim: 0, final: 0 },
  paymentPlanDesc: '',
  clientOrg: 'KOICA',
  groupwareName: '',
  participantCondition: '',
  department: '개발협력센터',
  teamName: '',
  managerId: 'u-old',
  managerName: '이전 담당자',
  registeredById: 'u-old',
  registeredByName: '이전 담당자',
  budgetCurrentYear: 1000,
  taxInvoiceAmount: 0,
  profitRate: 0,
  profitAmount: 0,
  isSettled: false,
  finalPaymentNote: '',
  confirmerName: '',
  lastCheckedAt: '',
  cashflowDiffNote: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Project;

describe('project change request helpers', () => {
  it('keeps legacy requests as registration requests', () => {
    expect(resolveProjectRequestKind(null)).toBe('REGISTRATION');
    expect(resolveProjectRequestKind({ requestKind: 'CHANGE' } as any)).toBe('CHANGE');
  });

  it('stores before/proposed snapshots, changed fields, and request version', () => {
    const draft = createProjectEditorDraft({
      name: '2026 CTS2 수정',
      officialContractName: 'CTS2 수정 계약명',
      type: 'D1',
      status: 'IN_PROGRESS',
      phase: 'CONFIRMED',
      clientOrg: 'KOICA',
      department: '개발협력센터',
      contractAmount: 2000,
      registeredById: 'u-berry',
      registeredByName: '김인효(베리)',
    });

    const request = buildProjectChangeRequest({
      baseProject,
      draft,
      actorId: 'u-berry',
      actorName: '김인효(베리)',
      actorEmail: 'berry@example.com',
      tenantId: 'mysc',
      requestedAt: '2026-05-29T01:29:00.000Z',
    });

    expect(request).toMatchObject({
      id: 'change-p-cts2',
      requestKind: 'CHANGE',
      targetProjectId: 'p-cts2',
      baseProjectVersion: 7,
      requestVersion: 1,
      status: 'PENDING',
      requestedByName: '김인효(베리)',
    });
    expect(request.beforeSnapshot?.name).toBe('2026 CTS2');
    expect(request.proposedSnapshot?.name).toBe('2026 CTS2 수정');
    expect(request.changedFields?.some((change) => change.key === 'name')).toBe(true);
    expect(request.humanSummary).toContain('기준 프로젝트 v7');
  });

  it('applies an approved request payload as a project patch', () => {
    const draft = createProjectEditorDraft({
      ...baseProject,
      name: '2026 CTS2 수정',
      contractAmount: 3000,
      registeredById: 'u-berry',
      registeredByName: '김인효(베리)',
    });
    const request = buildProjectChangeRequest({
      baseProject,
      draft,
      actorId: 'u-berry',
      actorName: '김인효(베리)',
      actorEmail: 'berry@example.com',
      tenantId: 'mysc',
      requestedAt: '2026-05-29T01:29:00.000Z',
    });
    const patch = buildProjectPatchFromRequestPayload(request.payload, {
      baseProject,
      approvedAt: '2026-05-29T02:00:00.000Z',
      reviewerId: 'admin',
      reviewerName: '관리자',
      changedFields: request.changedFields,
    });

    expect(patch).toMatchObject({
      name: '2026 CTS2 수정',
      contractAmount: 3000,
      registeredById: 'u-berry',
      managerId: 'u-berry',
      executiveReviewStatus: 'APPROVED',
    });
    expect(patch.executiveReviewHistory?.at(-1)?.changes?.length).toBeGreaterThan(0);
  });
});
