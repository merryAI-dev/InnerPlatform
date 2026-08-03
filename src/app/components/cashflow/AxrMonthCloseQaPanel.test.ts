import { describe, expect, it, vi } from 'vitest';
import {
  AXR_MONTH_CLOSE_QA_PROJECT_ID,
  AXR_MONTH_CLOSE_QA_PROJECT_NAME,
  executeAxrMonthCloseQaAction,
  isAxrMonthCloseQaEligible,
  resolveAxrMonthCloseQaResetAction,
  type QaControl,
} from './AxrMonthCloseQaPanel';

const actor = { uid: 'actor-a', email: 'ai@mysc.co.kr', role: 'admin', idToken: 'token' } as const;

function control(overrides: Partial<QaControl> = {}): QaControl {
  return {
    enabled: true,
    projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID,
    projectName: AXR_MONTH_CLOSE_QA_PROJECT_NAME,
    yearMonth: '2026-08',
    close: { status: 'OPEN', revision: 4, snapshotHash: 'sha256:snapshot', latestVersionId: 'v4' },
    request: { requestId: `${AXR_MONTH_CLOSE_QA_PROJECT_ID}-2026-08`, status: 'PENDING', revision: 2, manifestHash: 'sha256:manifest', approverUid: 'actor-a' },
    cumulativeHead: null,
    allowedActions: ['APPROVE_REQUEST', 'REJECT_REQUEST', 'REFRESH'],
    confirmationToken: `${AXR_MONTH_CLOSE_QA_PROJECT_NAME} / 2026-08 / r4`,
    ...overrides,
  };
}

function clients() {
  return { reviewRequest: vi.fn(), requestReopen: vi.fn(), decideReopen: vi.fn() };
}

describe('AXR month-close QA containment', () => {
  it('only exposes the panel to the exact project and privileged roles', () => {
    expect(isAxrMonthCloseQaEligible({ projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, projectName: AXR_MONTH_CLOSE_QA_PROJECT_NAME, role: 'admin' })).toBe(true);
    expect(isAxrMonthCloseQaEligible({ projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, projectName: AXR_MONTH_CLOSE_QA_PROJECT_NAME, role: 'finance' })).toBe(true);
    expect(isAxrMonthCloseQaEligible({ projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, projectName: `${AXR_MONTH_CLOSE_QA_PROJECT_NAME} `, role: 'admin' })).toBe(false);
    expect(isAxrMonthCloseQaEligible({ projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, projectName: ` ${AXR_MONTH_CLOSE_QA_PROJECT_NAME}`, role: 'finance' })).toBe(false);
    expect(isAxrMonthCloseQaEligible({ projectId: 'other-project', projectName: AXR_MONTH_CLOSE_QA_PROJECT_NAME, role: 'admin' })).toBe(false);
    expect(isAxrMonthCloseQaEligible({ projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, projectName: 'AXR프로젝트경비', role: 'admin' })).toBe(false);
  });

  it('maps reset to an audited existing transition and never invents a delete action', () => {
    expect(resolveAxrMonthCloseQaResetAction(['REJECT_REQUEST', 'REFRESH'])).toBe('REJECT_REQUEST');
    expect(resolveAxrMonthCloseQaResetAction(['REQUEST_REOPEN', 'REFRESH'])).toBe('REQUEST_REOPEN');
    expect(resolveAxrMonthCloseQaResetAction(['APPROVE_REOPEN', 'REJECT_REOPEN', 'REFRESH'])).toBe('APPROVE_REOPEN');
    expect(resolveAxrMonthCloseQaResetAction(['REFRESH'])).toBe('REFRESH');
  });

  it('uses the existing review API with the persisted revision, manifest, and stable idempotency key', async () => {
    const api = clients();
    const current = control();
    await executeAxrMonthCloseQaAction({
      action: 'REJECT_REQUEST', control: current, projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID,
      yearMonth: '2026-08', tenantId: 'tenant-a', actor, reason: ' QA reset ',
      confirmation: current.confirmationToken, backupConfirmed: true, clients: api as never,
    });
    expect(api.reviewRequest).toHaveBeenCalledOnce();
    expect(api.reviewRequest).toHaveBeenCalledWith(expect.objectContaining({
      projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID,
      requestId: `${AXR_MONTH_CLOSE_QA_PROJECT_ID}-2026-08`,
      payload: { decision: 'REJECT', expectedRevision: 2, expectedManifestHash: 'sha256:manifest', reason: 'QA reset' },
      idempotencyKey: `axr-month-close-qa:REJECT_REQUEST:${AXR_MONTH_CLOSE_QA_PROJECT_ID}-2026-08:r2`,
    }));
  });

  it('uses only the existing reopen APIs with the close revision', async () => {
    const api = clients();
    const closed = control({ request: null, close: { status: 'CLOSED', revision: 7, snapshotHash: 'sha256:closed', latestVersionId: 'v7' }, allowedActions: ['REQUEST_REOPEN', 'REFRESH'] });
    await executeAxrMonthCloseQaAction({
      action: 'REQUEST_REOPEN', control: closed, projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID,
      yearMonth: '2026-08', tenantId: 'tenant-a', actor, reason: 'reopen',
      confirmation: closed.confirmationToken, backupConfirmed: true, clients: api as never,
    });
    expect(api.requestReopen).toHaveBeenCalledWith(expect.objectContaining({
      payload: { yearMonth: '2026-08', expectedRevision: 7, reason: 'reopen' },
      idempotencyKey: `axr-month-close-qa:REQUEST_REOPEN:${AXR_MONTH_CLOSE_QA_PROJECT_ID}:2026-08:r7`,
    }));

    const requested = control({ request: null, close: { status: 'REOPEN_REQUESTED', revision: 8, snapshotHash: 'sha256:closed', latestVersionId: 'v7' }, allowedActions: ['APPROVE_REOPEN', 'REJECT_REOPEN', 'REFRESH'] });
    await executeAxrMonthCloseQaAction({
      action: 'APPROVE_REOPEN', control: requested, projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID,
      yearMonth: '2026-08', tenantId: 'tenant-a', actor, reason: 'restore',
      confirmation: requested.confirmationToken, backupConfirmed: true, clients: api as never,
    });
    expect(api.decideReopen).toHaveBeenCalledWith(expect.objectContaining({
      payload: { yearMonth: '2026-08', expectedRevision: 8, decision: 'APPROVE', reason: 'restore' },
      idempotencyKey: `axr-month-close-qa:APPROVE_REOPEN:${AXR_MONTH_CLOSE_QA_PROJECT_ID}:2026-08:r8`,
    }));
  });

  it('fails closed on a wrong target, hidden action, token, reason, or backup check', async () => {
    const api = clients();
    const current = control();
    const base = { action: 'APPROVE_REQUEST' as const, control: current, projectId: AXR_MONTH_CLOSE_QA_PROJECT_ID, yearMonth: '2026-08', tenantId: 'tenant-a', actor, reason: 'approve', confirmation: current.confirmationToken, backupConfirmed: true, clients: api as never };
    await expect(executeAxrMonthCloseQaAction({ ...base, projectId: 'other' })).rejects.toThrow('허용되지 않은');
    await expect(executeAxrMonthCloseQaAction({ ...base, action: 'APPROVE_REOPEN' })).rejects.toThrow('허용되지 않은');
    await expect(executeAxrMonthCloseQaAction({ ...base, confirmation: 'wrong' })).rejects.toThrow('모두 입력');
    await expect(executeAxrMonthCloseQaAction({ ...base, reason: ' ' })).rejects.toThrow('모두 입력');
    await expect(executeAxrMonthCloseQaAction({ ...base, backupConfirmed: false })).rejects.toThrow('모두 입력');
    expect(api.reviewRequest).not.toHaveBeenCalled();
    expect(api.requestReopen).not.toHaveBeenCalled();
    expect(api.decideReopen).not.toHaveBeenCalled();
  });
});
