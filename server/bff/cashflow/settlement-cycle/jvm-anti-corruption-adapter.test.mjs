import { describe, expect, it } from 'vitest';

import { requireCashflowSettlementCycleReadContext } from './jvm-anti-corruption-adapter.mjs';

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

function cycle(overrides = {}) {
  return {
    cycleYearMonth: '2026-09',
    weeklyYearMonth: '2026-09',
    monthCloseTargetYearMonth: '2026-08',
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

describe('cashflow settlement-cycle JVM anti-corruption adapter', () => {
  it('accepts and preserves the exact actor-scoped JVM command capability set', () => {
    const context = requireCashflowSettlementCycleReadContext(
      { settlementCycle: cycle() },
      { projectId: 'project-a', cycleYearMonth: '2026-09' },
    );

    expect(context.commandCapabilities).toEqual(cycle().commandCapabilities);
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
    expect(() => requireCashflowSettlementCycleReadContext(
      { settlementCycle: createCycle() },
      { projectId: 'project-a', cycleYearMonth: '2026-09' },
    )).toThrow(/월 결산 사이클 응답/);
  });

  it('rejects enabled commands when the canonical projection is not ready', () => {
    expect(() => requireCashflowSettlementCycleReadContext(
      { settlementCycle: cycle({ health: 'RECONCILING' }) },
      { projectId: 'project-a', cycleYearMonth: '2026-09' },
    )).toThrow(/월 결산 사이클 응답/);
  });

  it('requires every known target-keyed legacy capability to be denied', () => {
    expect(() => requireCashflowSettlementCycleReadContext({
      settlementCycle: cycle({
        businessState: 'APPROVED',
        workflowRevision: 4,
        provenance: {
          affectedFromMonth: '2026-06',
          affectedThroughMonth: '2026-08',
          closedByCycleYearMonth: '2026-09',
          approvalVersionId: 'approval-v4',
          requestId: 'project-a-2026-08',
          ledgerRevision: 4,
          rootHash: `sha256:${'a'.repeat(64)}`,
        },
        commandCapabilities: {
          ...deniedCapabilities('LEGACY_READ_ONLY'),
          REQUEST_MONTH_REOPEN: { allowed: true, reasonCode: '' },
        },
      }),
    }, {
      projectId: 'project-a',
      cycleYearMonth: '2026-09',
    })).toThrow(/월 결산 사이클 응답/);
  });
});
