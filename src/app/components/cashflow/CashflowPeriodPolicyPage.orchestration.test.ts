import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformApiError } from '../../platform/api-client';

const mocks = vi.hoisted(() => ({
  stateIndex: 0,
  setters: [] as ReturnType<typeof vi.fn>[],
  fetchPolicy: vi.fn(),
  updateApprover: vi.fn(),
  recoverHead: vi.fn(),
  resetToReclose: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect(effect: () => void | (() => void)) {
      effect();
    },
    useState<T>(initial: T) {
      const setter = mocks.setters[mocks.stateIndex++];
      if (!setter) throw new Error('unexpected useState call');
      return [initial, setter] as const;
    },
  };
});

vi.mock('../../data/auth-store', () => ({
  useAuth: () => ({
    user: {
      uid: 'admin-uid', name: '변민욱', email: 'admin@example.com', role: 'admin', idToken: 'token',
    },
  }),
}));

vi.mock('../../lib/firebase-context', () => ({ useFirebase: () => ({ orgId: 'tenant-a' }) }));
vi.mock('../../lib/platform-bff-client', () => ({ isPlatformApiEnabled: () => true }));
vi.mock('../../lib/cashflow-period-policy-client', () => ({
  fetchCashflowPeriodPolicy: mocks.fetchPolicy,
  updateCashflowExecutiveApprover: mocks.updateApprover,
  recoverCashflowCumulativeCloseHead: mocks.recoverHead,
  resetCashflowCumulativeCloseToReclose: mocks.resetToReclose,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

import { CashflowPeriodPolicyPage } from './CashflowPeriodPolicyPage';

const recoveryEvidence = { contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1' };
const resetEvidence = { contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1' };
const item = {
  project: { id: 'project-a', name: 'AXR 프로젝트' },
  executiveApprover: { expectedVersion: 7 },
  recovery: { expectedEvidence: recoveryEvidence },
};
const snapshot = { items: [item] };

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CashflowPeriodPolicyPage orchestration', () => {
  beforeEach(() => {
    mocks.stateIndex = 0;
    mocks.setters = Array.from({ length: 5 }, () => vi.fn());
    mocks.fetchPolicy.mockReset().mockResolvedValue(snapshot);
    mocks.updateApprover.mockReset().mockResolvedValue({});
    mocks.recoverHead.mockReset().mockResolvedValue({ statusLabel: '권한 복구 완료' });
    mocks.resetToReclose.mockReset().mockResolvedValue({ statusLabel: '재결산 준비 완료' });
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it('서버 snapshot을 불러오고 세 mutation을 서버 근거 그대로 보낸 뒤 재조회한다', async () => {
    const page = CashflowPeriodPolicyPage() as unknown as { props: Record<string, (...args: any[]) => Promise<void>> };
    await flushPromises();

    expect(mocks.fetchPolicy).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
    expect(mocks.setters[0]).toHaveBeenCalledWith({ kind: 'loading' });
    expect(mocks.setters[0]).toHaveBeenCalledWith({ kind: 'ready', snapshot });

    await page.props.onUpdateExecutiveApprover(item, 'people-next', '조직 개편');
    await page.props.onRecoverCumulativeCloseHead(item, '누락 권한 복구');
    await page.props.onResetCumulativeCloseToReclose(item, '재결산 준비', resetEvidence);

    expect(mocks.updateApprover).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', projectId: 'project-a', approverUid: 'people-next',
      expectedVersion: 7, reason: '조직 개편',
      idempotencyKey: expect.stringMatching(/^cashflow-period-policy-/),
    }));
    expect(mocks.recoverHead).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', projectId: 'project-a', reason: '누락 권한 복구',
      expectedEvidence: recoveryEvidence,
      idempotencyKey: expect.stringMatching(/^cashflow-close-head-recovery-/),
    }));
    expect(mocks.resetToReclose).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', projectId: 'project-a', reason: '재결산 준비',
      expectedEvidence: resetEvidence,
      idempotencyKey: expect.stringMatching(/^cashflow-close-reset-to-reclose-/),
    }));
    expect(mocks.setters[2].mock.calls.map(([value]) => value)).toEqual(['project-a', '']);
    expect(mocks.setters[3].mock.calls.map(([value]) => value)).toEqual(['project-a', '']);
    expect(mocks.setters[4].mock.calls.map(([value]) => value)).toEqual(['project-a', '']);
    expect(mocks.setters[1]).toHaveBeenCalledTimes(3);
    for (const [increment] of mocks.setters[1].mock.calls) expect(increment(4)).toBe(5);
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(3);
  });

  it('조회와 복구의 403을 동일한 권한 안내 상태로 전환한다', async () => {
    const forbidden = new PlatformApiError('Forbidden', 403, 'request-1', { error: 'forbidden' });
    mocks.fetchPolicy.mockRejectedValue(forbidden);
    mocks.recoverHead.mockRejectedValue(forbidden);

    const page = CashflowPeriodPolicyPage() as unknown as { props: Record<string, (...args: any[]) => Promise<void>> };
    await flushPromises();
    await page.props.onRecoverCumulativeCloseHead(item, '권한 확인');

    expect(mocks.setters[0]).toHaveBeenCalledWith({ kind: 'forbidden' });
    expect(mocks.setters[3].mock.calls.map(([value]) => value)).toEqual(['project-a', '']);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
