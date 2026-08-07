import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CASHFLOW_APPLY_LEASE_MS,
  cashflowApplyLeaseMs,
  readCashflowApplyLeaseState,
} from './cashflow-apply-lease.mjs';

const LEASE_MS = DEFAULT_CASHFLOW_APPLY_LEASE_MS;
const STARTED_AT = '2026-08-06T13:00:00.000Z';
const STARTED_AT_MS = Date.parse(STARTED_AT);

function applyingPublication(overrides = {}) {
  return {
    status: 'APPLYING',
    stagedRunId: 'run-1',
    applyStartedAt: STARTED_AT,
    ...overrides,
  };
}

describe('cashflowApplyLeaseMs', () => {
  it('falls back to the default when the override is unset or invalid', () => {
    expect(cashflowApplyLeaseMs({})).toBe(LEASE_MS);
    expect(cashflowApplyLeaseMs({ CASHFLOW_APPLY_LEASE_MS: '' })).toBe(LEASE_MS);
    expect(cashflowApplyLeaseMs({ CASHFLOW_APPLY_LEASE_MS: 'abc' })).toBe(LEASE_MS);
    expect(cashflowApplyLeaseMs({ CASHFLOW_APPLY_LEASE_MS: '-1' })).toBe(LEASE_MS);
  });

  it('reads an explicit override including the disabling zero', () => {
    expect(cashflowApplyLeaseMs({ CASHFLOW_APPLY_LEASE_MS: '60000' })).toBe(60_000);
    expect(cashflowApplyLeaseMs({ CASHFLOW_APPLY_LEASE_MS: '0' })).toBe(0);
  });
});

describe('readCashflowApplyLeaseState', () => {
  it('does not block when no apply is running', () => {
    const state = readCashflowApplyLeaseState({ status: 'READY' }, { nowMs: STARTED_AT_MS, leaseMs: LEASE_MS });
    expect(state).toMatchObject({ applying: false, blocked: false, expired: false });
  });

  it('blocks while the lease is still held', () => {
    const state = readCashflowApplyLeaseState(applyingPublication(), {
      nowMs: STARTED_AT_MS + LEASE_MS - 1,
      leaseMs: LEASE_MS,
    });
    expect(state.blocked).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.expiresAt).toBe(new Date(STARTED_AT_MS + LEASE_MS).toISOString());
  });

  it('stops blocking once the lease expires', () => {
    const state = readCashflowApplyLeaseState(applyingPublication(), {
      nowMs: STARTED_AT_MS + LEASE_MS,
      leaseMs: LEASE_MS,
    });
    expect(state.expired).toBe(true);
    expect(state.blocked).toBe(false);
    expect(state.stagedRunId).toBe('run-1');
  });

  it('keeps blocking indefinitely when the lease is disabled', () => {
    const state = readCashflowApplyLeaseState(applyingPublication(), {
      nowMs: STARTED_AT_MS + LEASE_MS * 1000,
      leaseMs: 0,
    });
    expect(state.expired).toBe(false);
    expect(state.blocked).toBe(true);
    expect(state.expiresAt).toBe('');
  });

  it('does not expire a publication that never recorded a start time', () => {
    const state = readCashflowApplyLeaseState(applyingPublication({ applyStartedAt: '' }), {
      nowMs: STARTED_AT_MS + LEASE_MS * 10,
      leaseMs: LEASE_MS,
    });
    expect(state.missingStartedAt).toBe(true);
    expect(state.expired).toBe(false);
    expect(state.blocked).toBe(true);
  });

  it('ignores an unparsable start time instead of expiring on it', () => {
    const state = readCashflowApplyLeaseState(applyingPublication({ applyStartedAt: 'not-a-date' }), {
      nowMs: STARTED_AT_MS + LEASE_MS * 10,
      leaseMs: LEASE_MS,
    });
    expect(state.missingStartedAt).toBe(true);
    expect(state.blocked).toBe(true);
  });
});
