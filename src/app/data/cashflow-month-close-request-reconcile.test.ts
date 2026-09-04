import { describe, expect, it, vi } from 'vitest';
import type { CashflowMonthCloseRequest } from '../lib/platform-bff-client';
import {
  isRequestFromThisAttempt,
  isRequestTimeoutError,
  reconcileMonthCloseRequestAfterTimeout,
} from './cashflow-month-close-request-reconcile';

const base = {
  documentType: 'MONTHLY_CLOSE',
  requestId: 'p1-2026-08',
  projectId: 'p1',
  yearMonth: '2026-08',
  status: 'PENDING_APPROVAL',
  canDecideReopen: false,
  revision: 1,
  requestedByUid: 'me',
  requestedAt: '2026-08-19T00:46:23.282Z',
} as unknown as CashflowMonthCloseRequest;

describe('month close request reconcile after client timeout', () => {
  it('recognises the client timeout error only', () => {
    const timeout = new Error('서버 응답이 늦어 요청을 중단했습니다.');
    timeout.name = 'TimeoutError';
    expect(isRequestTimeoutError(timeout)).toBe(true);
    expect(isRequestTimeoutError(new Error('409'))).toBe(false);
    expect(isRequestTimeoutError(null)).toBe(false);
  });

  it('accepts only a live request made by this actor after this attempt started', () => {
    const startedAtIso = '2026-08-19T00:46:00.000Z';
    expect(isRequestFromThisAttempt(base, { actorUid: 'me', startedAtIso })).toBe(true);
    expect(isRequestFromThisAttempt({ ...base, requestedByUid: 'someone' }, { actorUid: 'me', startedAtIso })).toBe(false);
    expect(isRequestFromThisAttempt({ ...base, requestedAt: '2026-08-19T00:45:59.000Z' }, { actorUid: 'me', startedAtIso })).toBe(false);
    expect(isRequestFromThisAttempt({ ...base, status: 'REJECTED' }, { actorUid: 'me', startedAtIso })).toBe(false);
    expect(isRequestFromThisAttempt(null, { actorUid: 'me', startedAtIso })).toBe(false);
  });

  it('returns the request once the canonical cycle shows it pending approval', async () => {
    const fetchCurrent = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ...base, status: 'BUILDING' })
      .mockResolvedValueOnce(base);
    const sleep = vi.fn(async () => {});
    const result = await reconcileMonthCloseRequestAfterTimeout({
      fetchCurrent, actorUid: 'me', startedAtIso: '2026-08-19T00:46:00.000Z', attempts: 5, sleep,
    });
    expect(result).toEqual(base);
    expect(fetchCurrent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up with null when the request never appears', async () => {
    const fetchCurrent = vi.fn(async () => null);
    const sleep = vi.fn(async () => {});
    const result = await reconcileMonthCloseRequestAfterTimeout({
      fetchCurrent, actorUid: 'me', startedAtIso: '2026-08-19T00:46:00.000Z', attempts: 3, sleep,
    });
    expect(result).toBeNull();
    expect(fetchCurrent).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not adopt an older request left by someone else', async () => {
    const fetchCurrent = vi.fn(async () => ({ ...base, requestedByUid: 'other' }));
    const result = await reconcileMonthCloseRequestAfterTimeout({
      fetchCurrent, actorUid: 'me', startedAtIso: '2026-08-19T00:46:00.000Z', attempts: 2, sleep: async () => {},
    });
    expect(result).toBeNull();
  });
});
