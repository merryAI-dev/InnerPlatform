import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  assertSettlementCycleInventoryStable,
  assertSettlementCycleCutoverReady,
  buildSettlementCycleHeadMigrationBody,
  buildSettlementCycleRolloutInventory,
  createSettlementCycleJvmOperations,
  executeSettlementCycleHeadMigrations,
  parseSettlementCycleRolloutArgs,
  readSettlementCycleRolloutInventory,
  settlementCycleRolloutAuditSummary,
  settlementCycleRolloutFingerprint,
  validateSettlementCycleRolloutOptions,
  verifySettlementCycleProjections,
} from './cashflow-settlement-cycle-rollout.mjs';

const rootHash = `sha256:${'a'.repeat(64)}`;
const execFileAsync = promisify(execFile);
const settlementCycleCommands = [
  'SUBMIT_MONTH_CLOSE', 'WITHDRAW_MONTH_CLOSE', 'APPROVE_MONTH_CLOSE', 'REJECT_MONTH_CLOSE',
  'REQUEST_MONTH_REOPEN', 'APPROVE_MONTH_REOPEN', 'REJECT_MONTH_REOPEN', 'CANCEL_ACTIVE_CYCLE',
];

function lockedCapabilities() {
  return {
    ...Object.fromEntries(settlementCycleCommands.map((command) => [command, {
      allowed: false, reasonCode: 'BUSINESS_STATE_NOT_ELIGIBLE',
    }])),
    REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
  };
}

function lockedMonthCloseSettlement() {
  return {
    period: 'MONTH', status: 'LOCKED', revision: 2,
    submittedAt: '2026-09-03T01:00:00Z', submittedBy: 'pm-1',
    approvedAt: '2026-09-03T02:00:00Z', approvedBy: 'head-1',
    deadlineAt: '2026-09-10T15:00:00Z', approverDeadlineAt: '2026-09-30T15:00:00Z',
  };
}

function lockedSettlementStatuses() {
  return {
    projectId: 'project-a',
    yearMonth: '2026-09',
    items: [
      lockedMonthCloseSettlement(),
      ...Array.from({ length: 5 }, (_, index) => ({
        period: `WEEK_${index + 1}`, status: 'WAITING_FOR_UPDATE', revision: 0,
        submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '',
        deadlineAt: '2026-09-06T15:00:00Z', approverDeadlineAt: '2026-09-07T04:00:00Z',
      })),
    ],
  };
}

function document(id, data) {
  return { id, data };
}

describe('cashflow settlement-cycle rollout audit', () => {
  it('classifies legacy authority, unresolved requests, and canonical verification targets without writing', () => {
    const inventory = buildSettlementCycleRolloutInventory({
      requests: [
        document('legacy-pending', {
          projectId: 'project-a', status: 'APPROVING', yearMonth: '2026-08',
        }),
        document('project-b-2026-09', {
          documentType: 'REQUEST', contractVersion: 'cashflow-cumulative-close-v2',
          requestId: 'project-b-2026-09', projectId: 'project-b', status: 'APPROVED',
          cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
        }),
        document('__active__-project-b', {
          documentType: 'ACTIVE_COORDINATOR', projectId: 'project-b',
          activeState: 'INACTIVE', workflowRevision: 2,
        }),
      ],
      heads: [
        document('project-a', {
          contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
          status: 'CLOSED', closedThrough: '2026-08', settlementMonth: '2026-09',
          fromMonth: '2023-01', revision: 4, rootHash,
          requestId: 'project-a-2026-09', requestRevision: 2,
          approvalId: 'approval-a', operationId: 'operation-a',
        }),
        document('project-b', {
          contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-b',
          status: 'CLOSED', authorityExists: true, revision: 8, rootHash,
          fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
          closedRanges: [{
            affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
            closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-b',
            requestId: 'project-b-2026-09', ledgerRevision: 1, rootHash,
          }],
        }),
      ],
      settlements: [
        document('project-a-2026-08', {
          projectId: 'project-a', yearMonth: '2026-08',
          periods: { MONTH: { status: 'COMPLETED' } },
        }),
      ],
    });

    expect(inventory.counts).toMatchObject({
      legacyHeads: 1,
      canonicalHeads: 1,
      unresolvedRequests: 1,
      legacyActiveRequests: 1,
      coordinators: 1,
      genericMonthDocuments: 1,
    });
    expect(inventory.legacyHeads).toEqual([{
      projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
    }]);
    expect(inventory.verificationTargets).toEqual([{
      projectId: 'project-b', cycleYearMonth: '2026-09', requestId: 'project-b-2026-09',
    }]);
    expect(() => assertSettlementCycleCutoverReady(inventory, [])).toThrow(/not ready/i);
  });

  it('requires every canonical authority head to have a JVM-verifiable projection target', () => {
    const valid = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 3, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-09', ledgerRevision: 2, rootHash,
        }],
      })],
    });
    expect(valid.verificationTargets).toContainEqual({
      projectId: 'project-a', cycleYearMonth: '2026-09', requestId: 'project-a-2026-09',
    });

    const invalid = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 3, rootHash,
        closedRanges: [{ affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08' }],
      })],
    });
    expect(invalid.counts.invalidHeads).toBe(1);
    expect(invalid.counts.canonicalHeads).toBe(0);
    expect(invalid.verificationTargets).toEqual([]);
  });

  it('accepts only the two verified request identities for a migrated authority range', () => {
    const targetKeyed = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 3, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 2, rootHash,
        }],
      })],
    });
    expect(targetKeyed.verificationTargets).toEqual([{
      projectId: 'project-a', cycleYearMonth: '2026-09', requestId: 'project-a-2026-08',
    }]);

    const foreign = structuredClone(targetKeyed);
    expect(buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 3, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-b-2026-09', ledgerRevision: 2, rootHash,
        }],
      })],
    }).counts.invalidHeads).toBe(1);
    expect(foreign.counts.invalidHeads).toBe(0);
  });

  it('classifies active requests by canonical shape and accepts only JVM coordinator states', () => {
    const inventory = buildSettlementCycleRolloutInventory({
      requests: [
        document('legacy-v2-pending', {
          contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
          status: 'PENDING_APPROVAL', cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
        }),
        document('__active__-valid', {
          documentType: 'ACTIVE_COORDINATOR', projectId: 'project-a',
          activeState: 'PENDING_APPROVAL', activeCycleYearMonth: '2026-09',
          activeRequestId: 'project-a-2026-09', workflowRevision: 2,
        }),
        document('__active__-invalid', {
          documentType: 'ACTIVE_COORDINATOR', projectId: 'project-b',
          activeState: 'SUBMITTED', activeCycleYearMonth: '2026-09',
          activeRequestId: 'project-b-2026-09', workflowRevision: 2,
        }),
      ],
    });

    expect(inventory.legacyActiveRequests).toEqual([{
      requestId: 'legacy-v2-pending', projectId: 'project-a', status: 'PENDING_APPROVAL',
    }]);
    expect(inventory.invalidCoordinators).toEqual([{
      id: '__active__-invalid', projectId: 'project-b',
    }]);
  });

  it('requires an explicit production identity, allowlist, actor, reason, and JVM endpoint before apply', () => {
    expect(() => validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--apply', '--firebase-project', 'live-project', '--tenant', 'mysc',
    ]))).toThrow(/confirm-project/i);
    expect(() => validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--apply', '--firebase-project', 'live-project', '--confirm-project', 'other-project',
      '--tenant', 'mysc', '--confirm-tenant', 'mysc', '--allow-projects', 'project-a',
      '--people-uid', 'admin-1', '--reason', '승인된 이관', '--jvm-base-url', 'https://jvm.example',
    ]))).toThrow(/confirm-project/i);
    expect(() => validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--apply', '--firebase-project', 'live-project', '--confirm-project', 'live-project',
      '--tenant', 'mysc', '--confirm-tenant', 'mysc', '--allow-projects', '*',
      '--people-uid', 'admin-1', '--reason', '승인된 이관', '--jvm-base-url', 'https://jvm.example',
    ]))).toThrow(/allow-projects/i);
    expect(validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--apply', '--firebase-project', 'live-project', '--confirm-project', 'live-project',
      '--tenant', 'mysc', '--confirm-tenant', 'mysc', '--allow-projects', 'project-a',
      '--people-uid', 'admin-1', '--reason', '승인된 이관', '--jvm-base-url', 'https://jvm.example',
    ]))).toMatchObject({ apply: true, allowProjects: ['project-a'] });
    expect(() => validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--verify-cutover', '--firebase-project', 'live-project', '--tenant', 'mysc',
      '--jvm-base-url', 'https://jvm.example',
    ]))).toThrow(/people-uid/i);
    expect(() => validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--verify-cutover', '--firebase-project', 'live-project', '--tenant', 'mysc',
      '--people-uid', 'admin-1', '--jvm-base-url', 'http://jvm.example/path',
    ]))).toThrow(/https/i);
    expect(validateSettlementCycleRolloutOptions(parseSettlementCycleRolloutArgs([
      '--verify-cutover', '--firebase-project', 'live-project', '--tenant', 'mysc',
      '--people-uid', 'admin-1', '--jvm-base-url', 'https://candidate.example',
      '--jvm-audience', 'https://service.example',
    ]))).toMatchObject({
      jvmBaseUrl: 'https://candidate.example', jvmAudience: 'https://service.example',
    });
  });

  it('builds one deterministic actor-bound migration command without inventing evidence', () => {
    expect(buildSettlementCycleHeadMigrationBody({
      tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
      projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
    })).toEqual({
      idempotencyKey: `settlement-head-v2:mysc:project-a:r4:${'a'.repeat(16)}`,
      expectedHeadRevision: 4,
      expectedHeadRootHash: rootHash,
      reason: '승인된 이관',
    });
  });

  it('migrates only exact allowlisted legacy heads and validates the canonical JVM response', async () => {
    const migrate = vi.fn(async ({ projectId, body }) => ({
      ok: true,
      commandName: 'cashflowSettlementCycle.migrateHeadV2',
      projectId,
      closedThrough: '2026-08',
      cycleYearMonth: '2026-09',
      approvalVersionId: 'version-1',
      headRevision: body.expectedHeadRevision + 1,
      auditId: 'settlement-cycle-head-migration-1',
    }));

    const result = await executeSettlementCycleHeadMigrations({
      inventory: {
        legacyHeads: [
          { projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash },
          { projectId: 'project-b', expectedHeadRevision: 2, expectedHeadRootHash: `sha256:${'b'.repeat(64)}` },
        ],
      },
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate,
    });

    expect(migrate).toHaveBeenCalledTimes(1);
    expect(migrate).toHaveBeenCalledWith({
      projectId: 'project-a',
      body: buildSettlementCycleHeadMigrationBody({
        tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
      }),
    });
    expect(result).toEqual([{ projectId: 'project-a', headRevision: 5, auditId: 'settlement-cycle-head-migration-1' }]);
  });

  it('reaches the JVM immutable receipt when an allowlisted head was already migrated after response loss', async () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'mysc', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 5, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '2026-08-27T03:04:05Z', migratedByUid: 'admin-1',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });
    const immutableReceipt = {
      ok: true,
      commandName: 'cashflowSettlementCycle.migrateHeadV2',
      projectId: 'project-a',
      closedThrough: '2026-08',
      cycleYearMonth: '2026-09',
      approvalVersionId: 'version-a',
      headRevision: 5,
      auditId: 'settlement-cycle-head-migration-immutable',
    };
    const migrate = vi.fn(async () => immutableReceipt);

    const result = await executeSettlementCycleHeadMigrations({
      inventory,
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate,
    });

    expect(migrate).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledWith({
      projectId: 'project-a',
      body: buildSettlementCycleHeadMigrationBody({
        tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        projectId: 'project-a', expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
      }),
    });
    expect(result).toEqual([{
      projectId: 'project-a', headRevision: 5,
      auditId: 'settlement-cycle-head-migration-immutable',
    }]);
  });

  it('fails closed instead of replaying a migrated head bound to a different actor', async () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'mysc', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 5, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '2026-08-27T03:04:05Z', migratedByUid: 'admin-2',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });
    const migrate = vi.fn();

    expect(inventory.migratedHeads).toEqual([expect.objectContaining({
      projectId: 'project-a', migratedByUid: 'admin-2',
      expectedHeadRevision: 4, expectedHeadRootHash: rootHash,
    })]);
    await expect(executeSettlementCycleHeadMigrations({
      inventory,
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate,
    })).rejects.toThrow(/actor|eligible/i);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('fails closed instead of replaying canonical evidence scoped to a different tenant', async () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'other-tenant', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 5, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '2026-08-27T03:04:05Z', migratedByUid: 'admin-1',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });
    const migrate = vi.fn();

    await expect(executeSettlementCycleHeadMigrations({
      inventory,
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate,
    })).rejects.toThrow(/tenant|eligible/i);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('does not replay a migration after the canonical head entered a reopen workflow', async () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'mysc', projectId: 'project-a',
        status: 'REOPEN_REQUESTED', authorityExists: true, revision: 6, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '2026-08-27T03:04:05Z', migratedByUid: 'admin-1',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });
    const migrate = vi.fn();

    expect(inventory.migratedHeads).toEqual([]);
    await expect(executeSettlementCycleHeadMigrations({
      inventory,
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate,
    })).rejects.toThrow(/not eligible/i);
    expect(migrate).not.toHaveBeenCalled();
  });

  it('does not treat a loosely parseable migration timestamp as canonical replay evidence', () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'mysc', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 5, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '0', migratedByUid: 'admin-1',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });

    expect(inventory.migratedHeads).toEqual([]);
    expect(inventory.counts.replayableMigratedHeads).toBe(0);
  });

  it('fails closed when a replay receipt does not match the already-migrated canonical evidence', async () => {
    const inventory = buildSettlementCycleRolloutInventory({
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', tenantId: 'mysc', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 5, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        requestId: 'project-a-2026-08', requestRevision: 3,
        approvalId: 'approval-a', operationId: 'operation-a',
        migratedAt: '2026-08-27T03:04:05Z', migratedByUid: 'admin-1',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-08', ledgerRevision: 3, rootHash,
        }],
      })],
    });

    await expect(executeSettlementCycleHeadMigrations({
      inventory,
      options: {
        apply: true, tenantId: 'mysc', actorUid: 'admin-1', reason: '승인된 이관',
        allowProjects: ['project-a'],
      },
      migrate: async () => ({
        ok: true, commandName: 'cashflowSettlementCycle.migrateHeadV2',
        projectId: 'project-a', closedThrough: '2026-07', cycleYearMonth: '2026-08',
        approvalVersionId: 'version-other', headRevision: 5, auditId: 'audit-other',
      }),
    })).rejects.toThrow(/invalid migration response/i);
  });

  it('emits only aggregate counts, blockers, and a full-state fingerprint for rollout audit logs', () => {
    const report = {
      mode: 'APPLY',
      firebaseProjectId: 'secret-firebase-project',
      tenantId: 'secret-tenant',
      before: {
        counts: {
          legacyHeads: 1, canonicalHeads: 2, invalidHeads: 0,
          unresolvedRequests: 0, legacyActiveRequests: 0,
          coordinators: 2, invalidCoordinators: 0, genericMonthDocuments: 4,
        },
        canonicalState: {
          heads: [{ projectId: 'secret-project', rootHash: 'secret-root-hash', migratedByUid: 'secret-actor' }],
          requests: [{ requestId: 'secret-request', submittedAt: 'secret-request-time' }],
          settlements: [{ month: { approvedBy: 'secret-approver', approvedAt: 'secret-approval-time' } }],
        },
      },
      migrations: [{ projectId: 'secret-project', auditId: 'secret-audit-id', headRevision: 5 }],
      after: {
        counts: {
          legacyHeads: 0, canonicalHeads: 3, invalidHeads: 0,
          unresolvedRequests: 0, legacyActiveRequests: 0,
          coordinators: 2, invalidCoordinators: 0, genericMonthDocuments: 4,
        },
        canonicalState: { heads: [{ migratedAt: 'secret-migrated-time' }] },
      },
      projections: [{ projectId: 'secret-project', requestId: 'secret-request' }],
      cutover: { ready: true, verifiedProjects: 1 },
    };

    const summary = settlementCycleRolloutAuditSummary(report);
    const serialized = JSON.stringify(summary);

    expect(Object.keys(summary)).toEqual(['counts', 'blockers', 'fingerprint']);
    expect(summary.counts).toEqual({
      before: { ...report.before.counts, replayableMigratedHeads: 0 },
      migrations: 1,
      after: { ...report.after.counts, replayableMigratedHeads: 0 },
      projections: 1,
      verifiedProjects: 1,
    });
    expect(summary.blockers).toEqual({});
    expect(summary.fingerprint).toBe(settlementCycleRolloutFingerprint(report));
    for (const secret of [
      'secret-firebase-project', 'secret-tenant', 'secret-project', 'secret-root-hash',
      'secret-actor', 'secret-request', 'secret-request-time', 'secret-approver',
      'secret-approval-time', 'secret-audit-id', 'secret-migrated-time',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const actorChanged = structuredClone(report);
    actorChanged.before.canonicalState.heads[0].migratedByUid = 'different-actor';
    expect(settlementCycleRolloutAuditSummary(actorChanged).fingerprint).not.toBe(summary.fingerprint);
  });

  it('reports an unhealthy matching projection only as an aggregate blocker count', () => {
    const report = {
      before: { counts: {} },
      migrations: [],
      after: {
        counts: {},
        verificationTargets: [{
          projectId: 'secret-project', cycleYearMonth: '2026-09', requestId: 'secret-request',
        }],
      },
      projections: [{
        projectId: 'secret-project', cycleYearMonth: '2026-09', requestId: 'secret-request',
        businessState: 'LOCKED', health: 'INCONSISTENT',
      }],
      cutover: null,
    };

    const summary = settlementCycleRolloutAuditSummary(report);

    expect(summary.blockers).toEqual({ invalidProjections: 1 });
    expect(JSON.stringify(summary)).not.toContain('secret-project');
    expect(JSON.stringify(summary)).not.toContain('secret-request');
  });

  it('opens the frontend cutover gate only after storage and JVM projections agree', () => {
    const inventory = {
      counts: {
        legacyHeads: 0, invalidHeads: 0, unresolvedRequests: 0,
        legacyActiveRequests: 0, invalidCoordinators: 0,
      },
      verificationTargets: [
        { projectId: 'project-a', cycleYearMonth: '2026-09', requestId: 'project-a-2026-09' },
      ],
    };
    expect(assertSettlementCycleCutoverReady(inventory, [{
      projectId: 'project-a', cycleYearMonth: '2026-09',
      businessState: 'LOCKED', health: 'OK', requestId: 'project-a-2026-09',
    }])).toEqual({ ready: true, verifiedProjects: 1 });
    expect(() => assertSettlementCycleCutoverReady(inventory, [{
      projectId: 'project-a', cycleYearMonth: '2026-09',
      businessState: 'LOCKED', health: 'INCONSISTENT', requestId: 'project-a-2026-09',
    }])).toThrow(/not ready/i);
  });

  it('rejects a cutover check when canonical storage changes during projection verification', () => {
    const before = {
      counts: { legacyHeads: 0, unresolvedRequests: 0 },
      verificationTargets: [{ projectId: 'project-a', cycleYearMonth: '2026-09', requestId: 'request-a' }],
    };
    expect(assertSettlementCycleInventoryStable(before, structuredClone(before))).toEqual({ stable: true });
    expect(() => assertSettlementCycleInventoryStable(before, {
      ...before,
      counts: { legacyHeads: 0, unresolvedRequests: 1 },
    })).toThrow(/changed/i);

    const canonicalBefore = buildSettlementCycleRolloutInventory({
      requests: [document('__active__-project-a', {
        documentType: 'ACTIVE_COORDINATOR', projectId: 'project-a',
        activeState: 'PENDING_APPROVAL', activeCycleYearMonth: '2026-09',
        activeRequestId: 'project-a-2026-09', workflowRevision: 2,
      })],
      heads: [document('project-a', {
        contractVersion: 'cashflow-cumulative-close-v2', projectId: 'project-a',
        status: 'CLOSED', authorityExists: true, revision: 3, rootHash,
        fromMonth: '2023-01', closedThrough: '2026-08', settlementMonth: '2026-09',
        closedRanges: [{
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-09', ledgerRevision: 2, rootHash,
        }],
      })],
    });
    const canonicalAfter = structuredClone(canonicalBefore);
    canonicalAfter.canonicalState.requests[0].workflowRevision = 3;
    expect(canonicalAfter.counts).toEqual(canonicalBefore.counts);
    expect(canonicalAfter.verificationTargets).toEqual(canonicalBefore.verificationTargets);
    expect(() => assertSettlementCycleInventoryStable(canonicalBefore, canonicalAfter)).toThrow(/changed/i);
  });

  it('reads the three canonical Firestore collections once for one inventory snapshot', async () => {
    const collections = {
      'orgs/mysc/cashflow_month_close_requests': [document('request-1', { status: 'APPROVED' })],
      'orgs/mysc/cashflow_cumulative_close_heads': [document('project-a', { projectId: 'project-a' })],
      'orgs/mysc/cashflow_settlement_statuses': [document('project-a-2026-08', { periods: {} })],
    };
    const get = vi.fn(async (query) => ({ docs: collections[query.path] }));
    const runTransaction = vi.fn(async (callback) => callback({ get }));
    const db = { collection: (path) => ({ path }), runTransaction };

    const inventory = await readSettlementCycleRolloutInventory({ db, tenantId: 'mysc' });

    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls.map(([query]) => query.path)).toEqual(Object.keys(collections));
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
    expect(inventory.counts.invalidHeads).toBe(1);
  });

  it('verifies each approved projection against the exact project, cycle, and request provenance', async () => {
    const targets = [
      { projectId: 'project-a', cycleYearMonth: '2026-09', requestId: 'project-a-2026-09' },
    ];
    const readProjection = vi.fn(async () => ({
      settlementStatuses: lockedSettlementStatuses(),
      settlementCycle: {
        cycleYearMonth: '2026-09', weeklyYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
        businessState: 'LOCKED', health: 'OK', workflowRevision: 7,
        monthCloseSettlement: lockedMonthCloseSettlement(), supersededAttempt: null,
        commandCapabilities: lockedCapabilities(),
        provenance: {
          affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
          requestId: 'project-a-2026-09', ledgerRevision: 2, rootHash,
        },
      },
    }));
    const readAlignedRequest = vi.fn(async () => ({
      requestId: 'project-a-2026-09', cycleYearMonth: '2026-09',
      monthCloseTargetYearMonth: '2026-08', status: 'APPROVED', workflowRevision: 7,
    }));

    await expect(verifySettlementCycleProjections({
      targets, readProjection, readAlignedRequest,
    })).resolves.toEqual([{
      projectId: 'project-a', cycleYearMonth: '2026-09',
      requestId: 'project-a-2026-09', businessState: 'LOCKED', health: 'OK',
    }]);
    expect(readProjection).toHaveBeenCalledWith({ projectId: 'project-a', cycleYearMonth: '2026-09' });
    expect(readAlignedRequest).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a',
      context: expect.objectContaining({ requestId: 'project-a-2026-09' }),
    }));

    await expect(verifySettlementCycleProjections({
      targets,
      readAlignedRequest,
      readProjection: async () => ({
        settlementStatuses: lockedSettlementStatuses(),
        settlementCycle: {
          cycleYearMonth: '2026-09', weeklyYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
          businessState: 'LOCKED', health: 'OK', workflowRevision: 7,
          monthCloseSettlement: lockedMonthCloseSettlement(), supersededAttempt: null,
          commandCapabilities: lockedCapabilities(),
          provenance: {
            affectedFromMonth: '2023-01', affectedThroughMonth: '2026-08',
            closedByCycleYearMonth: '2026-09', approvalVersionId: 'version-a',
            requestId: 'project-b-2026-09', ledgerRevision: 2, rootHash,
          },
        },
      }),
    })).rejects.toThrow(/identity/i);
  });

  it('checks the JVM capability before exposing migration and canonical projection operations', async () => {
    const requestJson = vi.fn(async ({ path }) => {
      if (path === '/api/v1/health') {
        return { ok: true, capabilities: ['settlement-cycle-v1'] };
      }
      if (path.includes('/migrate-head-v2')) {
        return { ok: true, commandName: 'cashflowSettlementCycle.migrateHeadV2' };
      }
      return {
        settlementCycle: {
          cycleYearMonth: '2026-09', businessState: 'LOCKED', health: 'OK',
          provenance: { requestId: 'project-a-2026-09' },
        },
      };
    });
    const operations = await createSettlementCycleJvmOperations({
      client: { requestJson }, tenantId: 'mysc', actorUid: 'admin-1',
    });

    await operations.migrate({ projectId: 'project-a', body: { idempotencyKey: 'migration-1' } });
    await operations.readProjection({ projectId: 'project-a', cycleYearMonth: '2026-09' });

    expect(requestJson).toHaveBeenNthCalledWith(1, expect.objectContaining({
      method: 'GET', path: '/api/v1/health', retry: false,
    }));
    expect(requestJson).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: 'POST',
      path: '/api/v1/cashflow/project-a/settlement-cycle/migrate-head-v2',
      retry: false,
      mutation: true,
      body: { idempotencyKey: 'migration-1' },
      context: expect.objectContaining({ tenantId: 'mysc', actorId: 'admin-1', actorRole: 'admin' }),
    }));
    expect(requestJson).toHaveBeenNthCalledWith(3, expect.objectContaining({
      method: 'GET',
      path: '/api/v1/cashflow/project-a/month-close/dashboard-source?yearMonth=2026-09&settlementCycle=true',
      mutation: false,
    }));

    await expect(createSettlementCycleJvmOperations({
      client: { requestJson: async () => ({ ok: true, capabilities: [] }) },
      tenantId: 'mysc', actorUid: 'admin-1',
    })).rejects.toThrow(/capability/i);
  });

  it('documents a read-only default and all mutation confirmations in the executable CLI', async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      'scripts/audit-cashflow-settlement-cycle-rollout.mjs', '--help',
    ], { cwd: process.cwd() });

    expect(stdout).toContain('기본값: read-only');
    expect(stdout).toContain('--confirm-project');
    expect(stdout).toContain('--confirm-tenant');
    expect(stdout).toContain('--allow-projects');
    expect(stdout).toContain('--people-uid');
    expect(stdout).toContain('--reason');
    expect(stdout).toContain('--jvm-audience');
  });
});
