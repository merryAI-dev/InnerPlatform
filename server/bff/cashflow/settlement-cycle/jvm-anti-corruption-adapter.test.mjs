import { describe, expect, it } from 'vitest';

import {
  buildHistoricalCashflowSettlementCycle,
  readAlignedCashflowSettlementCycleRequest,
  requireCashflowSettlementCycleReadContext,
} from './jvm-anti-corruption-adapter.mjs';

const commands = [
  'SUBMIT_MONTH_CLOSE',
  'WITHDRAW_MONTH_CLOSE',
  'APPROVE_MONTH_CLOSE',
  'REJECT_MONTH_CLOSE',
  'REQUEST_MONTH_REOPEN',
  'APPROVE_MONTH_REOPEN',
  'REJECT_MONTH_REOPEN',
  'CANCEL_ACTIVE_CYCLE',
];

function deniedCapabilities(reasonCode = 'BUSINESS_STATE_NOT_ELIGIBLE') {
  return Object.fromEntries(commands.map((command) => [command, { allowed: false, reasonCode }]));
}

function canonicalCapabilities(businessState) {
  if (businessState === 'LOCKED') {
    return {
      ...deniedCapabilities(),
      REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
    };
  }
  if (businessState === 'REOPEN_REQUESTED') {
    return {
      ...deniedCapabilities(),
      APPROVE_MONTH_REOPEN: { allowed: false, reasonCode: 'REOPEN_DECISION_FORBIDDEN' },
      REJECT_MONTH_REOPEN: { allowed: false, reasonCode: 'REOPEN_DECISION_FORBIDDEN' },
    };
  }
  if (['REOPENED', 'REJECTED', 'WITHDRAWN'].includes(businessState)) {
    return {
      ...deniedCapabilities(),
      SUBMIT_MONTH_CLOSE: { allowed: true, reasonCode: '' },
      ...(businessState === 'REOPENED'
        ? { CANCEL_ACTIVE_CYCLE: { allowed: false, reasonCode: 'RECOVERY_ADMIN_REQUIRED' } }
        : {}),
    };
  }
  return {
    ...deniedCapabilities(),
    WITHDRAW_MONTH_CLOSE: { allowed: true, reasonCode: '' },
    APPROVE_MONTH_CLOSE: { allowed: false, reasonCode: 'NOT_CURRENT_APPROVER' },
    REJECT_MONTH_CLOSE: { allowed: false, reasonCode: 'NOT_CURRENT_APPROVER' },
    CANCEL_ACTIVE_CYCLE: { allowed: false, reasonCode: 'RECOVERY_ADMIN_REQUIRED' },
  };
}

function cycle(overrides = {}) {
  return {
    cycleYearMonth: '2026-09',
    weeklyYearMonth: '2026-09',
    monthCloseTargetYearMonth: '2026-08',
    closeDeadline: '2026-09-10',
    businessState: 'NOT_REQUESTED',
    health: 'OK',
    workflowRevision: 0,
    monthCloseSettlement: null,
    provenance: null,
    supersededAttempt: null,
    commandCapabilities: {
      ...deniedCapabilities(),
      SUBMIT_MONTH_CLOSE: { allowed: true, reasonCode: '' },
    },
    ...overrides,
  };
}

function projectionFromCycle(settlementCycle, statusOverrides = {}) {
  const monthStatus = ({
    NOT_REQUESTED: 'WAITING_FOR_UPDATE',
    SUBMITTED: 'SUBMITTED',
    LOCKED: 'LOCKED',
    REOPEN_REQUESTED: 'LOCKED',
    REOPENED: 'WAITING_FOR_UPDATE',
    REJECTED: 'WAITING_FOR_UPDATE',
    WITHDRAWN: 'WAITING_FOR_UPDATE',
    INCONSISTENT: 'WAITING_FOR_UPDATE',
  })[settlementCycle.businessState] || 'WAITING_FOR_UPDATE';
  const month = settlementCycle.monthCloseSettlement || monthSettlement(monthStatus);
  const { items = [month], ...otherStatusOverrides } = statusOverrides;
  return {
    settlementCycle,
    settlementStatuses: {
      projectId: 'project-a',
      yearMonth: '2026-09',
      items: [
        ...items,
        ...Array.from({ length: 5 }, (_, index) => ({
          period: `WEEK_${index + 1}`, status: 'WAITING_FOR_UPDATE',
          submittedAt: '', submittedBy: '', approvedAt: '', approvedBy: '', revision: 0,
          deadlineAt: '2026-09-03T15:00:00Z',
          approverDeadlineAt: '2026-09-04T04:00:00Z',
        })),
      ],
      ...otherStatusOverrides,
    },
  };
}

function projection(cycleOverrides = {}, statusOverrides = {}) {
  return projectionFromCycle(cycle(cycleOverrides), statusOverrides);
}

function monthSettlement(status) {
  const waiting = status === 'WAITING_FOR_UPDATE';
  return {
    period: 'MONTH',
    status,
    submittedAt: waiting ? '' : '2026-09-03T01:00:00Z',
    submittedBy: waiting ? '' : 'pm-1',
    approvedAt: status === 'LOCKED' ? '2026-09-03T02:00:00Z' : '',
    approvedBy: status === 'LOCKED' ? 'head-1' : '',
    revision: waiting ? 0 : status === 'LOCKED' ? 2 : 1,
    deadlineAt: '2026-09-10T15:00:00Z',
    approverDeadlineAt: '2026-09-30T15:00:00Z',
  };
}

it('adapts a historical MONTH without changing WEEK statuses', () => {
  const statuses = projection().settlementStatuses;
  statuses.yearMonth = '2026-08';
  statuses.items[0] = {
    ...statuses.items[0], status: 'PENDING_APPROVAL',
    submittedAt: '2026-08-10T01:00:00Z', submittedBy: 'pm-1', revision: 1,
  };
  statuses.items[1] = { ...statuses.items[1], status: 'PENDING_APPROVAL' };

  const result = buildHistoricalCashflowSettlementCycle(statuses, {
    projectId: 'project-a',
    cycleYearMonth: '2026-08',
  });

  expect(result.settlementStatuses.items[0].status).toBe('SUBMITTED');
  expect(result.settlementStatuses.items[1].status).toBe('PENDING_APPROVAL');
  expect(result.settlementCycle).toMatchObject({
    cycleYearMonth: '2026-08',
    weeklyYearMonth: '2026-08',
    monthCloseTargetYearMonth: '2026-07',
    closeDeadline: '2026-08-10',
    businessState: 'SUBMITTED', health: 'OK', provenance: null,
  });
  expect(Object.values(result.settlementCycle.commandCapabilities)).toEqual(
    Array.from({ length: 8 }, () => ({ allowed: false, reasonCode: 'HISTORICAL_READ_ONLY' })),
  );
});

function approvalProvenance(requestId = 'project-a-2026-09') {
  return {
    affectedFromMonth: '2023-01',
    affectedThroughMonth: '2026-08',
    closedByCycleYearMonth: '2026-09',
    approvalVersionId: 'approval-v2',
    requestId,
    ledgerRevision: 2,
    rootHash: `sha256:${'a'.repeat(64)}`,
  };
}

function coveredApprovalProvenance() {
  return {
    ...approvalProvenance('project-a-2026-10'),
    affectedThroughMonth: '2026-09',
    closedByCycleYearMonth: '2026-10',
  };
}

function contextForRequest(businessState, health = 'OK') {
  const monthStatus = ['LOCKED', 'REOPEN_REQUESTED'].includes(businessState)
    ? 'LOCKED'
    : ['REOPENED', 'REJECTED', 'WITHDRAWN'].includes(businessState)
      ? 'WAITING_FOR_UPDATE'
      : 'SUBMITTED';
  return readContext(projection({
    businessState,
    health,
    workflowRevision: 2,
    monthCloseSettlement: monthSettlement(monthStatus),
    provenance: ['LOCKED', 'REOPEN_REQUESTED'].includes(businessState)
      ? approvalProvenance()
      : null,
    commandCapabilities: health === 'OK'
      ? canonicalCapabilities(businessState)
      : deniedCapabilities('PROJECTION_NOT_READY'),
  }));
}

function canonicalRequest(context, status, overrides = {}) {
  return {
    documentType: 'REQUEST',
    contractVersion: 'cashflow-cumulative-close-v2',
    requestId: context.requestId,
    tenantId: 'tenant-a',
    projectId: 'project-a',
    yearMonth: context.requestCycleYearMonth,
    cycleYearMonth: context.requestCycleYearMonth,
    monthCloseTargetYearMonth: context.requestTargetYearMonth,
    throughMonth: context.requestTargetYearMonth,
    status,
    revision: 2,
    evidenceRevision: 2,
    workflowRevision: context.workflowRevision,
    approvalVersionId: context.approvalVersionId,
    ledgerRevision: context.ledgerRevision,
    manifestHash: context.rootHash || `sha256:${'b'.repeat(64)}`,
    ...overrides,
  };
}

function requestDb(record) {
  return {
    doc: () => ({
      get: async () => ({ exists: true, data: () => structuredClone(record) }),
    }),
  };
}

function readContext(source) {
  return requireCashflowSettlementCycleReadContext(source, {
    projectId: 'project-a', cycleYearMonth: '2026-09',
  });
}

function expectInvalid(source) {
  expect(() => readContext(source)).toThrow(/월 결산 사이클 응답/);
}

function alignRequest(context, record) {
  return readAlignedCashflowSettlementCycleRequest({
    db: requestDb(record), tenantId: 'tenant-a', projectId: 'project-a', context,
  });
}

describe('cashflow settlement-cycle JVM anti-corruption adapter', () => {
  it.each([
    ['SUBMITTED', null],
    ['LOCKED', approvalProvenance()],
  ])('accepts canonical MONTH state %s', (businessState, provenance) => {
    const context = readContext(projection({
      businessState,
      workflowRevision: businessState === 'LOCKED' ? 2 : 1,
      monthCloseSettlement: monthSettlement(businessState),
      provenance,
      commandCapabilities: canonicalCapabilities(businessState),
    }));

    expect(context.businessState).toBe(businessState);
    expect(context.cycle.monthCloseSettlement.status).toBe(businessState);
  });

  it.each(['REOPENED', 'REJECTED', 'WITHDRAWN'])(
    'accepts the JVM %s lifecycle with a reset MONTH settlement',
    (businessState) => {
      const context = readContext(projection({
        businessState,
        workflowRevision: 3,
        monthCloseSettlement: monthSettlement('WAITING_FOR_UPDATE'),
        commandCapabilities: canonicalCapabilities(businessState),
      }));

      expect(context.businessState).toBe(businessState);
      expect(context.cycle.monthCloseSettlement.status).toBe('WAITING_FOR_UPDATE');
    },
  );

  it.each([
    ['without an exact attempt', null, 0],
    ['after a rejected attempt', 'REJECTED', 4],
    ['after a withdrawn attempt', 'WITHDRAWN', 4],
  ])('accepts a later cumulative close %s and aligns its authority request', async (
    _label,
    supersededAttempt,
    workflowRevision,
  ) => {
    const waiting = { ...monthSettlement('WAITING_FOR_UPDATE'), revision: workflowRevision };
    const context = readContext(projection({
      businessState: 'LOCKED',
      workflowRevision,
      monthCloseSettlement: null,
      provenance: coveredApprovalProvenance(),
      supersededAttempt,
      commandCapabilities: canonicalCapabilities('LOCKED'),
    }, { items: [waiting] }));

    expect(context).toMatchObject({
      businessState: 'LOCKED',
      requestId: 'project-a-2026-10',
      requestCycleYearMonth: '2026-10',
      requestTargetYearMonth: '2026-09',
    });
    expect(context.cycle.monthCloseSettlement).toBeNull();
    await expect(alignRequest(context, canonicalRequest(context, 'APPROVED'))).resolves.toMatchObject({
      requestId: 'project-a-2026-10',
      yearMonth: '2026-10',
      throughMonth: '2026-09',
      status: 'APPROVED',
    });
  });

  it.each([
    ['a provenance range that does not cover the queried target', {
      affectedFromMonth: '2026-09',
    }],
    ['a closing cycle whose target disagrees with affectedThroughMonth', {
      affectedThroughMonth: '2026-08',
    }],
    ['a closing cycle older than the queried cycle', {
      affectedThroughMonth: '2026-07',
      closedByCycleYearMonth: '2026-08',
      requestId: 'project-a-2026-08',
    }],
    ['a non-string approval version', { approvalVersionId: {} }],
  ])('rejects a covered LOCKED cycle with %s', (_label, provenanceOverrides) => {
    const waiting = { ...monthSettlement('WAITING_FOR_UPDATE'), revision: 4 };
    expectInvalid(projection({
      businessState: 'LOCKED',
      workflowRevision: 4,
      monthCloseSettlement: null,
      provenance: { ...coveredApprovalProvenance(), ...provenanceOverrides },
      supersededAttempt: 'REJECTED',
      commandCapabilities: canonicalCapabilities('LOCKED'),
    }, { items: [waiting] }));
  });

  it.each([
    ['without its exact locked MONTH settlement', null, null],
    ['with a superseded attempt on the direct approval', monthSettlement('LOCKED'), 'REJECTED'],
  ])('rejects a LOCKED cycle %s', (_label, monthCloseSettlement, supersededAttempt) => {
    expectInvalid(projection({
      businessState: 'LOCKED',
      workflowRevision: 3,
      monthCloseSettlement,
      provenance: approvalProvenance(),
      supersededAttempt,
      commandCapabilities: canonicalCapabilities('LOCKED'),
    }));
  });

  it('accepts REOPEN_REQUESTED only with the locked MONTH settlement kept by the JVM', () => {
    const context = readContext(projection({
      businessState: 'REOPEN_REQUESTED',
      workflowRevision: 3,
      monthCloseSettlement: monthSettlement('LOCKED'),
      provenance: approvalProvenance(),
      commandCapabilities: canonicalCapabilities('REOPEN_REQUESTED'),
    }));

    expect(context.cycle.monthCloseSettlement.status).toBe('LOCKED');
  });

  it('accepts a later cumulative authority reopen while the queried cycle MONTH stays waiting', async () => {
    const waiting = { ...monthSettlement('WAITING_FOR_UPDATE'), revision: 4 };
    const context = readContext(projection({
      businessState: 'REOPEN_REQUESTED',
      workflowRevision: 5,
      monthCloseSettlement: null,
      provenance: coveredApprovalProvenance(),
      supersededAttempt: 'REJECTED',
      commandCapabilities: canonicalCapabilities('REOPEN_REQUESTED'),
    }, { items: [waiting] }));

    expect(context).toMatchObject({
      businessState: 'REOPEN_REQUESTED',
      requestId: 'project-a-2026-10',
      requestCycleYearMonth: '2026-10',
      requestTargetYearMonth: '2026-09',
    });
    expect(context.cycle.monthCloseSettlement).toBeNull();
    await expect(alignRequest(context, canonicalRequest(context, 'REOPEN_REQUESTED', {
      ledgerRevision: 3,
    }))).resolves.toMatchObject({
      requestId: 'project-a-2026-10',
      status: 'REOPEN_REQUESTED',
      ledgerRevision: 3,
    });
  });

  it('rejects a later cumulative authority paired with a locked queried-cycle MONTH', () => {
    const locked = monthSettlement('LOCKED');
    expectInvalid(projection({
      businessState: 'LOCKED',
      workflowRevision: 5,
      monthCloseSettlement: locked,
      provenance: coveredApprovalProvenance(),
      supersededAttempt: null,
      commandCapabilities: canonicalCapabilities('LOCKED'),
    }, { items: [locked] }));
  });

  it('rejects an exact REOPENED attempt with a later cumulative authority', () => {
    const waiting = { ...monthSettlement('WAITING_FOR_UPDATE'), revision: 5 };
    expectInvalid(projection({
      businessState: 'REOPENED',
      workflowRevision: 5,
      monthCloseSettlement: waiting,
      provenance: coveredApprovalProvenance(),
      commandCapabilities: canonicalCapabilities('REOPENED'),
    }, { items: [waiting] }));
  });

  it.each([
    ['legacy target-key MONTH status', [{ ...monthSettlement('LOCKED'), status: 'COMPLETED' }]],
    ['MONTH revision that differs from the cycle item', [{
      ...monthSettlement('SUBMITTED'), revision: 9,
    }]],
    ['MONTH deadline that differs from the cycle item', [{
      ...monthSettlement('SUBMITTED'),
      deadlineAt: '2026-09-11T15:00:00Z',
    }]],
    ['duplicate MONTH period', [monthSettlement('SUBMITTED'), monthSettlement('SUBMITTED')]],
  ])('rejects split-brain settlement statuses with a %s', (_label, items) => {
    expectInvalid(projection({
      businessState: 'SUBMITTED',
      workflowRevision: 1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: canonicalCapabilities('SUBMITTED'),
    }, { items }));
  });

  it('rejects a cycle projection without its canonical settlement statuses', () => {
    const source = projection();
    delete source.settlementStatuses;
    expectInvalid(source);
  });

  it('rejects a canonical settlement status set with a missing week', () => {
    const source = projection();
    source.settlementStatuses.items = source.settlementStatuses.items
      .filter((item) => item.period !== 'WEEK_3');
    expectInvalid(source);
  });

  it('rejects malformed common fields on a WEEK settlement', () => {
    const source = projection();
    const week = source.settlementStatuses.items.find((item) => item.period === 'WEEK_1');
    week.submittedAt = {};
    week.deadlineAt = [];
    expectInvalid(source);
  });

  it('rejects whitespace-normalized canonical response identity', () => {
    const source = projection();
    source.settlementStatuses.projectId = ' project-a ';
    expectInvalid(source);
  });

  it.each([undefined, 'garbage'])('rejects a non-object canonical provenance value %s', (provenance) => {
    expectInvalid(projection({ provenance }));
  });

  it.each([
    ['workflow revision', () => projection({ workflowRevision: '0' })],
    ['MONTH revision', () => {
      const source = projection({
        businessState: 'SUBMITTED', workflowRevision: 1,
        monthCloseSettlement: monthSettlement('SUBMITTED'),
        commandCapabilities: canonicalCapabilities('SUBMITTED'),
      });
      source.settlementCycle.monthCloseSettlement.revision = '1';
      source.settlementStatuses.items[0].revision = '1';
      return source;
    }],
    ['provenance ledger revision', () => projection({
      businessState: 'LOCKED', workflowRevision: 2,
      monthCloseSettlement: monthSettlement('LOCKED'),
      provenance: { ...approvalProvenance(), ledgerRevision: '2' },
      commandCapabilities: canonicalCapabilities('LOCKED'),
    })],
  ])('rejects a string-valued canonical %s', (_label, source) => {
    expectInvalid(source());
  });

  it.each([
    ['state-ineligible enabled command', {
      commandCapabilities: {
        ...canonicalCapabilities('SUBMITTED'),
        REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
      },
    }],
    ['MONTH status that disagrees with the cycle state', {
      monthCloseSettlement: monthSettlement('LOCKED'),
    }],
    ['a close deadline outside the cycle identity', {
      closeDeadline: '2026-09-24',
    }],
  ])('rejects a SUBMITTED projection with %s', (_label, overrides) => {
    expectInvalid(projection({
      businessState: 'SUBMITTED',
      workflowRevision: 1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: canonicalCapabilities('SUBMITTED'),
      ...overrides,
    }));
  });

  it.each([
    ['PENDING_APPROVAL', { workflowRevision: 1 }],
    ['APPROVED', {
      workflowRevision: 2,
      provenance: approvalProvenance(),
      commandCapabilities: deniedCapabilities(),
    }],
  ])('rejects legacy MONTH state %s from a runtime projection', (businessState, overrides) => {
    expectInvalid(projection({ businessState, ...overrides }));
  });

  it('rejects target-keyed v1 provenance from a runtime projection', () => {
    expectInvalid(projection({
      businessState: 'LOCKED',
      workflowRevision: 2,
      monthCloseSettlement: monthSettlement('LOCKED'),
      provenance: approvalProvenance('project-a-2026-08'),
      commandCapabilities: canonicalCapabilities('LOCKED'),
    }));
  });

  it('accepts and preserves the exact actor-scoped JVM command capability set', () => {
    const context = readContext(projection());

    expect(context.commandCapabilities).toEqual(cycle().commandCapabilities);
  });

  it('accepts a future actor-scoped denial reason for a state-eligible command', () => {
    const context = readContext(projection({
      businessState: 'SUBMITTED',
      workflowRevision: 1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: {
        ...canonicalCapabilities('SUBMITTED'),
        WITHDRAW_MONTH_CLOSE: { allowed: false, reasonCode: 'FUTURE_POLICY_DENIAL' },
      },
    }));

    expect(context.commandCapabilities.WITHDRAW_MONTH_CLOSE).toEqual({
      allowed: false,
      reasonCode: 'FUTURE_POLICY_DENIAL',
    });
  });

  it('rejects LEGACY_READ_ONLY on a state-eligible command', () => {
    expectInvalid(projection({
      businessState: 'SUBMITTED',
      workflowRevision: 1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: {
        ...canonicalCapabilities('SUBMITTED'),
        WITHDRAW_MONTH_CLOSE: { allowed: false, reasonCode: 'LEGACY_READ_ONLY' },
      },
    }));
  });

  it('rejects PROJECTION_NOT_READY on a healthy projection', () => {
    expectInvalid(projection({
      businessState: 'SUBMITTED',
      workflowRevision: 1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: {
        ...canonicalCapabilities('SUBMITTED'),
        WITHDRAW_MONTH_CLOSE: { allowed: false, reasonCode: 'PROJECTION_NOT_READY' },
      },
    }));
  });

  it('accepts workflowRevision -1 only for an INCONSISTENT JVM projection', () => {
    const inconsistent = projection({
      businessState: 'INCONSISTENT',
      health: 'RECONCILING',
      workflowRevision: -1,
      commandCapabilities: deniedCapabilities('PROJECTION_NOT_READY'),
    });
    expect(readContext(inconsistent).workflowRevision).toBe(-1);

    expectInvalid(projection({
      businessState: 'SUBMITTED',
      workflowRevision: -1,
      monthCloseSettlement: monthSettlement('SUBMITTED'),
      commandCapabilities: canonicalCapabilities('SUBMITTED'),
    }));
    inconsistent.settlementCycle.workflowRevision = -2;
    expectInvalid(inconsistent);
  });

  it('accepts the JVM BUILDING projection only as a reconciling NOT_REQUESTED cycle', () => {
    const waiting = monthSettlement('WAITING_FOR_UPDATE');
    const context = readContext(projection({
      health: 'RECONCILING',
      monthCloseSettlement: waiting,
      commandCapabilities: deniedCapabilities('PROJECTION_NOT_READY'),
    }, { items: [waiting] }));

    expect(context).toMatchObject({ businessState: 'NOT_REQUESTED', health: 'RECONCILING', requestId: '' });
  });

  it('rejects a nested MONTH settlement on a healthy NOT_REQUESTED cycle', () => {
    const waiting = monthSettlement('WAITING_FOR_UPDATE');
    expectInvalid(projection({ monthCloseSettlement: waiting }, { items: [waiting] }));
  });

  it.each([
    ['SUBMITTED', 'OK', 'PENDING_APPROVAL'],
    ['SUBMITTED', 'RECONCILING', 'APPROVING'],
    ['SUBMITTED', 'RECONCILING', 'UNCERTAIN'],
    ['LOCKED', 'OK', 'APPROVED'],
    ['LOCKED', 'RECONCILING', 'APPROVING'],
    ['LOCKED', 'RECONCILING', 'UNCERTAIN'],
    ['REOPEN_REQUESTED', 'OK', 'REOPEN_REQUESTED'],
    ['REOPENED', 'OK', 'REOPENED'],
    ['REJECTED', 'OK', 'REJECTED'],
    ['WITHDRAWN', 'OK', 'WITHDRAWN'],
  ])('aligns the canonical %s/%s request status %s', async (businessState, health, status) => {
    const context = contextForRequest(businessState, health);
    await expect(alignRequest(context, canonicalRequest(context, status)))
      .resolves.toMatchObject({ status, tenantId: 'tenant-a' });
  });

  it.each([
    ['accepts current reopen ledger revision', 'REOPEN_REQUESTED', 'REOPEN_REQUESTED',
      { ledgerRevision: 3 }, { status: 'REOPEN_REQUESTED', ledgerRevision: 3 }, true],
    ['rejects ledger older than approval evidence', 'REOPEN_REQUESTED', 'REOPEN_REQUESTED',
      { ledgerRevision: 1 }, null, false],
    ['preserves terminal workflow behind coordinator', 'LOCKED', 'APPROVED',
      { workflowRevision: 1, ledgerRevision: 3 }, { workflowRevision: 1, ledgerRevision: 3 }, true],
    ['rejects terminal workflow ahead of coordinator', 'LOCKED', 'APPROVED',
      { workflowRevision: 3 }, null, false],
  ])('%s', async (_label, businessState, status, overrides, expected, valid) => {
    const context = contextForRequest(businessState);
    const assertion = expect(alignRequest(context, canonicalRequest(context, status, overrides)));
    if (valid) await assertion.resolves.toMatchObject(expected);
    else await assertion.rejects.toThrow(/월 결산 사이클 응답/);
  });

  it.each([
    ['a missing explicit cycle field', (request) => { delete request.cycleYearMonth; }],
    ['a conflicting legacy month alias', (request) => { request.yearMonth = '2026-08'; }],
    ['a missing tenant', (request) => { delete request.tenantId; }],
    ['a foreign tenant', (request) => { request.tenantId = 'tenant-b'; }],
    ['a whitespace-normalized project', (request) => { request.projectId = ' project-a '; }],
    ['a mismatched evidence revision', (request) => { request.evidenceRevision = 3; }],
    ['an invalid manifest hash', (request) => { request.manifestHash = 'sha256:not-a-hash'; }],
    ['an active workflow race', (request) => { request.workflowRevision = 3; }],
    ['the public SUBMITTED alias', (request) => { request.status = 'SUBMITTED'; }],
  ])('rejects a canonical SUBMITTED request with %s', async (_label, sabotage) => {
    const context = contextForRequest('SUBMITTED');
    const record = canonicalRequest(context, 'PENDING_APPROVAL');
    sabotage(record);
    await expect(alignRequest(context, record)).rejects.toThrow(/월 결산 사이클 응답/);
  });

  it('rejects the public LOCKED alias in canonical request storage', async () => {
    const context = contextForRequest('LOCKED');
    await expect(alignRequest(context, canonicalRequest(context, 'LOCKED')))
      .rejects.toThrow(/월 결산 사이클 응답/);
  });

  it.each([
    ['missing command', () => {
      const value = cycle();
      delete value.commandCapabilities.CANCEL_ACTIVE_CYCLE;
      return value;
    }],
    ['extra command', () => ({
      ...cycle(),
      commandCapabilities: { ...cycle().commandCapabilities, INVENTED_ACTION: { allowed: true, reasonCode: '' } },
    })],
    ['allowed command with a denial reason', () => ({
      ...cycle(),
      commandCapabilities: {
        ...cycle().commandCapabilities,
        SUBMIT_MONTH_CLOSE: { allowed: true, reasonCode: 'STATE_CHANGED' },
      },
    })],
    ['denied command without a stable reason', () => ({
      ...cycle(),
      commandCapabilities: {
        ...cycle().commandCapabilities,
        WITHDRAW_MONTH_CLOSE: { allowed: false, reasonCode: '' },
      },
    })],
  ])('rejects a malformed capability contract: %s', (_label, createCycle) => {
    expectInvalid(projectionFromCycle(createCycle()));
  });

  it('rejects enabled commands when the canonical projection is not ready', () => {
    expectInvalid(projection({ health: 'RECONCILING' }));
  });

  it('rejects an unknown global denial reason when the projection is not ready', () => {
    expectInvalid(projection({
      health: 'RECONCILING',
      commandCapabilities: deniedCapabilities('GARBAGE'),
    }));
  });

});
