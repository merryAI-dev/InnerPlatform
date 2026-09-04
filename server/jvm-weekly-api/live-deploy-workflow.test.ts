import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

import {
  advanceCashflowSettlementCutover,
  assertFirestoreRecoveryReady,
  assertProtectedCashflowSnapshotAfterNormalization,
  assertCashflowSettlementCutoverPreflightUnchanged,
  assertProtectedCashflowSnapshotUnchanged,
  buildCashflowSettlementCutoverPreflight,
  buildProtectedCashflowSnapshot,
  cashflowSettlementCutoverFailurePlan,
  resumeCashflowSettlementFinalWebCutover,
  vercelMutationDrainSeconds,
} from '../../scripts/verify-cashflow-settlement-cutover-sequence.mjs';
import { sha256, stableStringify } from '../bff/utils.mjs';

const document = (id: string, data: object, seconds = 1) => ({
  id,
  exists: true,
  data: () => data,
  updateTime: { seconds, nanoseconds: 0 },
});
const historicalProjects = [
  'p1773651024850', 'p1773817948751', 'p1774869407448', 'p1775040544761',
  'p1775123221342', 'p1775173797667', 'p1775182201215', 'p1775182504320',
  'p1775183713143', 'p1775202100607', 'p1775209262483', 'p1775710502280',
  'p1778219766945', 'p1780636846974', 'p1780662870530', 'p1784700960534',
];

function report(overrides: Record<string, unknown> = {}) {
  const projects = [
    'p1773817948751', 'p1776054335896', 'p1782702681869',
    ...Array.from({ length: 9 }, (_, index) => `protected-${index}`),
  ];
  const normalizationProjects = ['p1773817948751', 'p1775209262483', 'p1780662870530'];
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
        canonicalActiveRequests: 0,
        invalidActiveRequests: 0,
        unresolvedRequests: 0,
        legacyActiveRequests: 0,
        activeCoordinators: 0,
        invalidCoordinators: 0,
      },
      legacyHeads: projects.slice(0, 3).map((projectId) => ({ projectId })),
      recoverableHeads: [],
      historicalActiveRequests: historicalProjects.map((projectId) => ({
        requestId: `${projectId}-2026-08`, projectId, revision: 10,
        dataHash: projectId === 'p1773817948751'
          ? 'sha256:9a9b17f6cbc458076f305ffd9a2a6b6a980e216059e7576563a6023474762db6'
          : `sha256:${'a'.repeat(64)}`,
      })),
      normalizationCandidates: normalizationProjects.map((projectId) => ({
        requestId: `${projectId}-2026-09`, projectId, cycleYearMonth: '2026-09',
        monthCloseTargetYearMonth: '2026-08', expectedRequestRevision: 1,
        expectedManifestHash: `sha256:${'b'.repeat(64)}`,
        requestedAt: '2026-09-03T02:00:00Z', requestedByUid: 'pm-1',
      })),
      protectedSettlementStatuses: settlements.map(({ documentId }) => ({ documentId })),
      canonicalState: { settlements },
      ...overrides,
    },
  };
}

describe('cashflow settlement atomic cutover decisions', () => {
  it('accepts native recovery only when it covers the cutover window', () => {
    const now = Date.parse('2026-09-04T04:15:00Z');
    const database = {
      name: 'projects/live/databases/(default)',
      pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
      versionRetentionPeriod: '604800s',
      earliestVersionTime: '2026-08-28T04:15:00Z',
    };
    expect(assertFirestoreRecoveryReady({ backups: [], database }, now)).toMatchObject({ mode: 'pitr' });
    expect(assertFirestoreRecoveryReady({
      backups: [{ database: database.name, state: 'READY', createTime: '2026-09-04T04:00:00Z' }],
      database: { ...database, pointInTimeRecoveryEnablement: 'DISABLED' },
    }, now)).toMatchObject({ mode: 'backup' });
    for (const override of [
      { versionRetentionPeriod: '3600s' },
      { pointInTimeRecoveryEnablement: 'DISABLED' },
      { earliestVersionTime: '2026-09-04T04:16:00Z' },
    ]) expect(() => assertFirestoreRecoveryReady({ backups: [], database: { ...database, ...override } }, now)).toThrow();
  });

  it('compares legacy state while allowing the approved monthly deadline change', () => {
    const core = (value: object) => execFileSync(
      'jq', ['-S', '-c', '-f', 'scripts/cashflow-settlement-legacy-parity.jq'],
      { input: JSON.stringify(value), encoding: 'utf8' },
    ).trim();
    const live = {
      settlementCycle: null,
      monthCloseCalendar: [{ yearMonth: '2026-08', approverDeadlineAt: 'old' }],
      settlementStatuses: { items: [
        { period: 'MONTH', status: 'COMPLETED', approverDeadlineAt: 'old' },
        { period: 'WEEK_1', status: 'COMPLETED', approverDeadlineAt: 'same' },
      ] },
    };
    const candidate = structuredClone(live);
    candidate.monthCloseCalendar[0].approverDeadlineAt = 'new';
    candidate.settlementStatuses.items[0].approverDeadlineAt = 'new';
    expect(core(candidate)).toBe(core(live));
    candidate.settlementStatuses.items[1].status = 'PENDING_APPROVAL';
    expect(core(candidate)).not.toBe(core(live));
  });

  it('freezes exact projects and permits only drain, migrate, promote, then web', () => {
    const initialReport = report();
    const frozen = buildCashflowSettlementCutoverPreflight(initialReport);
    expect(frozen).toMatchObject({
      migrationCandidateProjects: ['p1773817948751', 'p1776054335896', 'p1782702681869'],
      normalizationProjects: ['p1773817948751', 'p1775209262483', 'p1780662870530'],
      historicalRequestIds: historicalProjects.map((projectId) => `${projectId}-2026-08`),
      protectedCompletedMonthProjects: [
        'p1773817948751', 'p1776054335896', 'p1782702681869',
        ...Array.from({ length: 9 }, (_, index) => `protected-${index}`),
      ].sort(),
      protectedStatusDocumentCount: 78,
    });
    expect(assertCashflowSettlementCutoverPreflightUnchanged(frozen, initialReport))
      .toMatchObject({ unchanged: true });
    const resumed = structuredClone(initialReport) as any;
    const resumedProject = 'p1775209262483';
    resumed.before.legacyHeads = [];
    resumed.before.recoverableHeads = frozen.migrationCandidateProjects.map((projectId) => ({ projectId }));
    resumed.before.historicalActiveRequests = resumed.before.historicalActiveRequests
      .filter(({ requestId }: { requestId: string }) => requestId !== 'p1773817948751-2026-08');
    resumed.before.normalizationCandidates = resumed.before.normalizationCandidates
      .filter(({ projectId }: { projectId: string }) => projectId !== resumedProject);
    resumed.before.canonicalActiveRequests = [{
      projectId: resumedProject, requestId: `${resumedProject}-2026-09`,
      cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08',
      workflowRevision: 1, evidenceRevision: 1, status: 'PENDING_APPROVAL',
      manifestHash: `sha256:${'b'.repeat(64)}`,
      requestedAt: '2026-09-03T02:00:00Z', requestedByUid: 'pm-1',
    }];
    resumed.before.activeCoordinatorRecords = [{
      projectId: resumedProject, requestId: `${resumedProject}-2026-09`,
      cycleYearMonth: '2026-09', workflowRevision: 1,
    }];
    resumed.before.counts = { ...resumed.before.counts, canonicalActiveRequests: 1, activeCoordinators: 1 };
    resumed.before.canonicalState.requests = [{
      documentId: 'p1773817948751-2026-08', requestId: 'p1773817948751-2026-08',
      documentType: 'REQUEST', contractVersion: 'cashflow-cumulative-close-v2',
      cycleYearMonth: '2026-08', monthCloseTargetYearMonth: '2026-07',
      status: 'APPROVED', revision: 8,
    }];
    resumed.before.canonicalState.settlements.push({
      documentId: `${resumedProject}-2026-09`, projectId: resumedProject,
      month: { status: 'SUBMITTED' },
    });
    resumed.before.protectedSettlementStatuses.push({ documentId: `${resumedProject}-2026-09` });
    expect(buildCashflowSettlementCutoverPreflight(resumed).protectedStatusDocumentCount).toBe(79);
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

    const statuses: ReturnType<typeof document>[] = Array.from({ length: 78 }, (_, index) => document(
      `status-${index}`,
      {
        projectId: `protected-${index % 12}`,
        periods: { MONTH: { status: 'COMPLETED' } },
      },
    ));
    const normalizationProjects = ['p1773817948751', 'p1775209262483', 'p1780662870530'];
    const normalizationRequests = normalizationProjects.map((projectId) => ({
      projectId, requestId: `${projectId}-2026-09`,
      requestedAt: '2026-09-03T02:00:00Z', requestedByUid: 'pm-1',
    }));
    statuses[0] = document('p1773817948751-2026-09', {
      tenantId: 'mysc', projectId: 'p1773817948751', yearMonth: '2026-09',
      periods: { WEEK_1: { status: 'COMPLETED' } }, updatedAt: '2026-09-03T01:00:00Z',
    });
    const archiveRaw = { requestId: 'p1773817948751-2026-08', status: 'UNCERTAIN', revision: 10 };
    const archiveRequest = {
      projectId: 'p1773817948751', requestId: 'p1773817948751-2026-08', revision: 10,
      dataHash: `sha256:${sha256(stableStringify(archiveRaw))}`,
    };
    const protectedState = buildProtectedCashflowSnapshot({
      statuses,
      completions: [document('completion', { status: 'LOCKED' })],
      versions: [document('completion-v1', { status: 'LOCKED', revision: 1 })],
      normalizationRequests,
      archiveSource: document(archiveRequest.requestId, archiveRaw),
      archiveRequest,
    });
    expect(assertProtectedCashflowSnapshotUnchanged(protectedState, protectedState))
      .toMatchObject({ unchanged: true });
    const submittedMonth = {
      status: 'SUBMITTED', revision: 1, submittedAt: '2026-09-03T02:00:00Z',
      submittedBy: 'pm-1', approvedAt: '', approvedBy: '',
    };
    const normalizedState = buildProtectedCashflowSnapshot({
      statuses: [
        ...statuses.map((entry) => entry.id === 'p1773817948751-2026-09'
          ? document(entry.id, {
              tenantId: 'mysc', projectId: 'p1773817948751', yearMonth: '2026-09',
              periods: { WEEK_1: { status: 'COMPLETED' }, MONTH: submittedMonth },
              updatedAt: '2026-09-04T01:00:00Z',
            }, 2)
          : entry),
        ...normalizationProjects.slice(1).map((projectId) => document(`${projectId}-2026-09`, {
          tenantId: 'mysc', projectId, yearMonth: '2026-09',
          periods: { MONTH: submittedMonth }, updatedAt: '2026-09-04T01:00:00Z',
        }, 2)),
      ],
      completions: [document('completion', { status: 'LOCKED' })],
      versions: [document('completion-v1', { status: 'LOCKED', revision: 1 })],
      normalizationRequests,
      archiveSource: document(archiveRequest.requestId, { status: 'APPROVED' }, 2),
      archiveDocument: document('stale-r10', archiveRaw, 2),
      archiveRequest,
    });
    expect(assertProtectedCashflowSnapshotAfterNormalization(protectedState, normalizedState))
      .toMatchObject({ unchanged: true });
    const resumedProtectedState = structuredClone(protectedState);
    resumedProtectedState.normalizationStatuses.splice(0, 2, ...normalizedState.normalizationStatuses.slice(0, 2));
    resumedProtectedState.normalizationStatuses.slice(0, 2)
      .forEach((record) => { record.alreadyNormalized = true; });
    resumedProtectedState.migrationArchive = normalizedState.migrationArchive;
    expect(assertProtectedCashflowSnapshotUnchanged(resumedProtectedState, resumedProtectedState))
      .toMatchObject({ unchanged: true });
    expect(assertProtectedCashflowSnapshotAfterNormalization(resumedProtectedState, normalizedState))
      .toMatchObject({ unchanged: true });
    const tampered = structuredClone(normalizedState);
    tampered.normalizationStatuses[0].canonicalMonth = false;
    expect(() => assertProtectedCashflowSnapshotAfterNormalization(protectedState, tampered)).toThrow();
    tampered.normalizationStatuses[0].canonicalMonth = true;
    tampered.migrationArchive!.archive!.dataHash = `sha256:${'f'.repeat(64)}`;
    expect(() => assertProtectedCashflowSnapshotAfterNormalization(protectedState, tampered)).toThrow();
  });

  it.each([
    ['unexpected current request', () => buildCashflowSettlementCutoverPreflight(report({
      counts: { invalidActiveRequests: 1 },
    }))],
    ['unexpected head candidate count', () => buildCashflowSettlementCutoverPreflight(report({
      legacyHeads: Array.from({ length: 4 }, (_, index) => ({ projectId: `unexpected-${index}` })),
    }))],
    ['unexpected historical request', () => buildCashflowSettlementCutoverPreflight(report({
      historicalActiveRequests: historicalProjects.map((projectId, index) => ({
        requestId: `${index ? projectId : 'unexpected'}-2026-08`, projectId,
      })),
    }))],
    ['inventory drift', () => {
      const frozen = buildCashflowSettlementCutoverPreflight(report());
      return assertCashflowSettlementCutoverPreflightUnchanged(frozen, report({
        normalizationCandidates: ['p1773817948751', 'p1775209262483', 'p1780662870530'].map((projectId, index) => ({
          requestId: `${projectId}-2026-09`, projectId,
          cycleYearMonth: index === 2 ? '2026-10' : '2026-09',
        })),
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
