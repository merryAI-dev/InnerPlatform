import { beforeEach, describe, expect, it, vi } from 'vitest';

const recovery = vi.hoisted(() => ({
  applyCumulativeCloseHeadPlan: vi.fn(),
  applyCumulativeCloseResetToReclose: vi.fn(),
  assertLinkedActivePeopleUid: vi.fn(),
}));

vi.mock('./cashflow-cumulative-close-head-recovery.mjs', () => recovery);

const { createCashflowPeriodPolicyFirestoreAdapter } = await import(
  './cashflow-period-policy-firestore-adapter.mjs'
);

function codedError(code) {
  return Object.assign(new Error('localized message that may change'), { code });
}

function adapter() {
  return createCashflowPeriodPolicyFirestoreAdapter({
    db: {
      collection: vi.fn(),
      doc: vi.fn(),
      runTransaction: vi.fn(),
    },
    auditChainService: { appendManyInTransaction: vi.fn() },
  });
}

describe('cashflow period policy recovery error mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    'RUNTIME_SUPERADMIN_REQUIRED',
    'RECOVERY_EVIDENCE_CHANGED',
    'RECOVERY_EVIDENCE_TRUNCATED',
  ])('maps recovery code %s without inspecting its message', async (code) => {
    recovery.applyCumulativeCloseHeadPlan.mockRejectedValueOnce(codedError(code));

    await expect(adapter().applyCumulativeCloseHeadRecovery({}))
      .rejects.toMatchObject({ name: 'CashflowPeriodPolicyPersistenceError', code });
  });

  it('does not classify an untyped recovery failure from its message text', async () => {
    recovery.applyCumulativeCloseHeadPlan.mockRejectedValueOnce(
      new Error('evidence changed and query limit exceeded'),
    );

    await expect(adapter().applyCumulativeCloseHeadRecovery({}))
      .rejects.toMatchObject({ code: 'RECOVERY_UNAVAILABLE' });
  });

  it.each([
    'RUNTIME_SUPERADMIN_REQUIRED',
    'RESET_NORMAL_REOPEN_REQUIRED',
    'RESET_EXACT_RECOVERY_REQUIRED',
    'RESET_EVIDENCE_CHANGED',
    'RESET_EVIDENCE_TRUNCATED',
  ])('maps reset code %s without inspecting its message', async (code) => {
    recovery.applyCumulativeCloseResetToReclose.mockRejectedValueOnce(codedError(code));

    await expect(adapter().applyCumulativeCloseResetToReclose({}))
      .rejects.toMatchObject({ name: 'CashflowPeriodPolicyPersistenceError', code });
  });

  it('does not classify an untyped reset failure from its message text', async () => {
    recovery.applyCumulativeCloseResetToReclose.mockRejectedValueOnce(
      new Error('valid authority requires normal reopen'),
    );

    await expect(adapter().applyCumulativeCloseResetToReclose({}))
      .rejects.toMatchObject({ code: 'RESET_UNAVAILABLE' });
  });
});
