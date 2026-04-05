import { describe, expect, it } from 'vitest';
import { mergeProjectMutationResult } from './project-store-mutation';
import type { Project } from './types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p001',
    version: 1,
    slug: 'p001',
    orgId: 'mysc',
    name: 'Test Project',
    status: 'CONTRACT_PENDING',
    type: 'I1',
    phase: 'CONFIRMED',
    contractAmount: 1000000,
    contractStart: '2026-01-01',
    contractEnd: '2026-12-31',
    settlementType: 'MONTHLY',
    basis: 'ACCRUAL',
    accountType: 'DEDICATED',
    paymentPlan: {
      contract: 0,
      interim: 0,
      final: 0,
    },
    paymentPlanDesc: '',
    clientOrg: 'Client',
    groupwareName: 'GW',
    participantCondition: '',
    contractType: '계약서',
    department: '개발협력센터',
    teamName: 'AXR',
    managerId: 'u001',
    managerName: '보람',
    budgetCurrentYear: 1000000,
    taxInvoiceAmount: 0,
    profitRate: 0,
    profitAmount: 0,
    isSettled: false,
    finalPaymentNote: '',
    confirmerName: '센터장',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeProjectMutationResult', () => {
  it('applies returned version and updatedAt to local project state', () => {
    const merged = mergeProjectMutationResult(
      makeProject(),
      {
        id: 'p001',
        version: 2,
        updatedAt: '2026-04-03T10:00:00.000Z',
      },
      {
        name: 'Updated Project',
      },
    );

    expect(merged.name).toBe('Updated Project');
    expect(merged.version).toBe(2);
    expect(merged.updatedAt).toBe('2026-04-03T10:00:00.000Z');
  });

  it('overrides trash metadata only when response explicitly carries it', () => {
    const base = makeProject({
      trashedAt: '2026-04-03T09:00:00.000Z',
      trashedById: 'u001',
      trashedByEmail: 'boram@example.com',
      trashedReason: '중복',
    });

    const restored = mergeProjectMutationResult(
      base,
      {
        id: 'p001',
        version: 3,
        updatedAt: '2026-04-03T11:00:00.000Z',
      },
      {
        trashedAt: null,
        trashedById: null,
        trashedByEmail: null,
        trashedReason: null,
      },
    );

    const trashed = mergeProjectMutationResult(
      makeProject(),
      {
        id: 'p001',
        version: 2,
        updatedAt: '2026-04-03T10:30:00.000Z',
        trashedAt: '2026-04-03T10:30:00.000Z',
      },
      {
        trashedById: 'u001',
        trashedReason: '중복',
      },
    );

    expect(restored.trashedAt).toBeNull();
    expect(restored.trashedReason).toBeNull();
    expect(trashed.trashedAt).toBe('2026-04-03T10:30:00.000Z');
    expect(trashed.trashedReason).toBe('중복');
  });
});
