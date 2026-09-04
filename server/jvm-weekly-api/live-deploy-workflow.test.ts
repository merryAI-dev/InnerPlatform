import { describe, expect, it } from 'vitest';

import {
  advanceCashflowSettlementCutover,
  assertCashflowSettlementCutoverPreflightUnchanged,
  assertProtectedCashflowSnapshotUnchanged,
  buildCashflowSettlementCutoverPreflight,
  buildProtectedCashflowSnapshot,
  cashflowSettlementCutoverFailurePlan,
  resumeCashflowSettlementFinalWebCutover,
  vercelMutationDrainSeconds,
} from '../../scripts/verify-cashflow-settlement-cutover-sequence.mjs';

const document = (id: string, data: object, seconds = 1) => ({
  id,
  data: () => data,
  updateTime: { seconds, nanoseconds: 0 },
});

function report(overrides: Record<string, unknown> = {}) {
  const projects = Array.from({ length: 12 }, (_, index) => `protected-${index}`);
  const settlements = Array.from({ length: 78 }, (_, index) => ({
    documentId: `status-${index}`,
    projectId: projects[index % projects.length],
    month: { status: 'COMPLETED' },
  }));
  return {
    mode: 'READ_ONLY',
    before: {
      counts: {
        invalidHeads: 0,
        unresolvedRequests: 0,
        legacyActiveRequests: 0,
        activeCoordinators: 0,
        invalidCoordinators: 0,
      },
      legacyHeads: projects.map((projectId) => ({ projectId })),
      recoverableHeads: [],
      protectedSettlementStatuses: settlements.map(({ documentId }) => ({ documentId })),
      canonicalState: { settlements },
      ...overrides,
    },
  };
}

describe('cashflow settlement atomic cutover decisions', () => {
  it('freezes exact projects and permits only drain, migrate, promote, then web', () => {
    const frozen = buildCashflowSettlementCutoverPreflight(report());
    expect(frozen).toMatchObject({
      migrationCandidateProjects: Array.from(
        { length: 12 }, (_, index) => `protected-${index}`,
      ).sort(),
      protectedCompletedMonthProjects: Array.from(
        { length: 12 }, (_, index) => `protected-${index}`,
      ).sort(),
      protectedStatusDocumentCount: 78,
    });
    expect(assertCashflowSettlementCutoverPreflightUnchanged(frozen, report()))
      .toMatchObject({ unchanged: true });
    expect(vercelMutationDrainSeconds({ functions: { 'api/bff.js': { maxDuration: 300 } } }))
      .toBe(300);

    let state = { phase: 'START' };
    for (const event of [
      'candidate_verified',
      'maintenance_aliased',
      'legacy_invocations_drained',
      'migration_started',
      'inventory_verified',
      'jvm_promoted',
      'final_web_aliased',
    ]) state = advanceCashflowSettlementCutover(state, event);
    expect(state).toEqual({ phase: 'COMPLETE' });
    expect(cashflowSettlementCutoverFailurePlan({ phase: 'DRAINED' }))
      .toEqual({ restoreOriginalAlias: true, keepMaintenance: false, rollbackJvm: true });
    expect(cashflowSettlementCutoverFailurePlan({ phase: 'MIGRATING' }))
      .toEqual({ restoreOriginalAlias: false, keepMaintenance: true, rollbackJvm: false });
    expect(advanceCashflowSettlementCutover(
      resumeCashflowSettlementFinalWebCutover(), 'final_web_aliased',
    )).toEqual({ phase: 'COMPLETE' });

    const statuses = Array.from({ length: 78 }, (_, index) => document(
      `status-${index}`,
      {
        projectId: `protected-${index % 12}`,
        periods: { MONTH: { status: 'COMPLETED' } },
      },
    ));
    const protectedState = buildProtectedCashflowSnapshot({
      statuses,
      completions: [document('completion', { status: 'LOCKED' })],
      versions: [document('completion-v1', { status: 'LOCKED', revision: 1 })],
    });
    expect(assertProtectedCashflowSnapshotUnchanged(protectedState, protectedState))
      .toMatchObject({ unchanged: true });
  });

  it.each([
    ['active request', () => buildCashflowSettlementCutoverPreflight(report({
      counts: { unresolvedRequests: 1 },
    }))],
    ['unprotected candidate', () => buildCashflowSettlementCutoverPreflight(report({
      legacyHeads: [
        ...Array.from({ length: 11 }, (_, index) => ({ projectId: `protected-${index}` })),
        { projectId: 'outside' },
      ],
    }))],
    ['inventory drift', () => {
      const frozen = buildCashflowSettlementCutoverPreflight(report());
      return assertCashflowSettlementCutoverPreflightUnchanged(frozen, report({
        legacyHeads: Array.from({ length: 11 }, (_, index) => ({ projectId: `protected-${index}` })),
        recoverableHeads: [{ projectId: 'protected-11' }],
      }));
    }],
    ['missing drain', () => advanceCashflowSettlementCutover(
      { phase: 'MAINTENANCE' }, 'migration_started',
    )],
    ['changed completion', () => {
      const before = buildProtectedCashflowSnapshot({
        statuses: Array.from({ length: 12 }, (_, index) => document(
          `status-${index}`,
          { projectId: `protected-${index}`, periods: { MONTH: { status: 'COMPLETED' } } },
        )),
        completions: [document('completion', { status: 'LOCKED' })],
      });
      const after = structuredClone(before);
      after.weeklyCompletions[0].updateTime.seconds += 1;
      return assertProtectedCashflowSnapshotUnchanged(before, after);
    }],
  ])('rejects sabotage: %s', (_name, sabotage) => {
    expect(sabotage).toThrow();
  });
});
