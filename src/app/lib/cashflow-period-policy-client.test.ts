import { describe, expect, it, vi } from 'vitest';
import {
  fetchCashflowPeriodPolicy,
  recoverCashflowCumulativeCloseHead,
  resetCashflowCumulativeCloseToReclose,
  updateCashflowExecutiveApprover,
  type CashflowCumulativeCloseHeadRecoveryResponse,
  type CashflowCumulativeCloseResetToRecloseResponse,
  type CashflowExecutiveApproverUpdateResponse,
  type CashflowPeriodPolicyResponse,
} from './cashflow-period-policy-client';

const response: CashflowPeriodPolicyResponse = {
  status: 'OK',
  statusLabel: '정상',
  tone: 'positive',
  generatedAt: '2026-08-14T03:00:00.000Z',
  generatedAtLabel: '2026.08.14 12:00',
  issues: [],
  superadmins: {
    status: 'OK',
    statusLabel: '슈퍼관리자 연결 정상',
    tone: 'positive',
    items: [{
      uid: 'uid-superadmin',
      personId: 'person-superadmin',
      displayName: '변민욱',
      identityStatus: 'LINKED',
      identityStatusLabel: 'People UID 연결됨',
      identityTone: 'positive',
    }],
  },
  executiveApproverCandidates: {
    status: 'OK',
    statusLabel: '조직장 후보 조회 완료',
    tone: 'positive',
    items: [{ uid: 'people-uid-a', personId: 'person-a', displayName: '김조직장' }],
  },
  amendments: {
    status: 'AVAILABLE',
    statusLabel: '닫힌 월 수정 이력 1건',
    tone: 'positive',
    rows: [{
      id: 'amendment-a', projectId: 'project-a', projectName: 'AXR 프로젝트',
      yearMonth: '2026-07', yearMonthLabel: '2026년 7월',
      reason: '7월 결산 후 직접사업비 정정', reasonLabel: '7월 결산 후 직접사업비 정정',
      actorUid: 'uid-superadmin', actorName: '변민욱', actorLabel: '변민욱',
      closeRevision: 2, closeRevisionLabel: '리비전 2',
      resultingCloseRevision: 3, resultingCloseRevisionLabel: '리비전 3',
      closeSnapshotHash: 'sha256:closed-july', closeSnapshotHashLabel: 'sha256:closed-july',
      sourceRevision: 'source-before', sourceRevisionLabel: 'source-before',
      targetRevision: 'target-before', targetRevisionLabel: 'target-before',
      resultingTargetRevision: 'target-after', resultingTargetRevisionLabel: 'target-after',
      createdAt: '2026-08-13T10:12:00.000Z', createdAtLabel: '2026.08.13 19:12',
    }],
  },
  forecastVariance: {
    status: 'UNAVAILABLE',
    statusLabel: '전사 편차 비교 불가',
    tone: 'critical',
    complete: false,
    eligibleCount: 0,
    coverageCount: 0,
    coverageLabel: '전사 비교 가능 0/0주차 · 부분 합계',
    totals: { complete: false, baseline: null, actual: null, variance: null, metrics: [] },
  },
  items: [],
};

describe('cashflow period policy client', () => {
  it('returns the server snapshot unchanged from the admin read endpoint', async () => {
    const client = { get: vi.fn().mockResolvedValue({ data: response }) } as any;

    const result = await fetchCashflowPeriodPolicy({
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a', role: 'admin', idToken: 'token-a' },
      client,
    });

    expect(result).toBe(response);
    expect(client.get).toHaveBeenCalledWith('/api/v1/admin/cashflow-period-policy', {
      tenantId: 'tenant-a',
      actor: { id: 'admin-a', email: undefined, role: 'admin', idToken: 'token-a' },
      retries: 0,
      timeoutMs: 12_000,
    });
  });

  it('updates only the executive approver field with optimistic version evidence', async () => {
    const result: CashflowExecutiveApproverUpdateResponse = {
      projectId: 'project-a',
      changed: true,
      executiveApprover: {
        status: 'LINKED', statusLabel: 'People UID 연결됨', tone: 'positive', uid: 'people-uid-a',
        personId: 'person-a', displayName: '김조직장', expectedVersion: 8, expectedVersionLabel: '프로젝트 리비전 8',
      },
      updatedAt: '2026-08-14T03:00:00.000Z',
      updatedAtLabel: '2026년 8월 14일 12:00',
    };
    const client = { patch: vi.fn().mockResolvedValue({ data: result }) } as any;

    await expect(updateCashflowExecutiveApprover({
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a', role: 'admin', idToken: 'token-a' },
      projectId: 'project-a',
      approverUid: 'people-uid-a',
      expectedVersion: 7,
      reason: 'People UID 정합성 확인',
      idempotencyKey: 'period-policy-project-a-7',
      client,
    })).resolves.toBe(result);

    expect(client.patch).toHaveBeenCalledWith(
      '/api/v1/admin/cashflow-period-policy/projects/project-a/executive-approver',
      {
        tenantId: 'tenant-a',
        actor: { id: 'admin-a', email: undefined, role: 'admin', idToken: 'token-a' },
        body: {
          approverUid: 'people-uid-a',
          expectedVersion: 7,
          reason: 'People UID 정합성 확인',
        },
        idempotencyKey: 'period-policy-project-a-7',
        retries: 0,
        timeoutMs: 12_000,
      },
    );
    expect(client.patch.mock.calls[0][1].body).not.toHaveProperty('project');
  });

  it('rejects unsafe project IDs and invalid versions before sending a mutation', async () => {
    const client = { patch: vi.fn() } as any;
    const base = {
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a' },
      approverUid: 'people-uid-a',
      expectedVersion: 1,
      reason: 'People UID 정합성 확인',
      idempotencyKey: 'period-policy-safe',
      client,
    };

    await expect(updateCashflowExecutiveApprover({ ...base, projectId: '../unsafe' }))
      .rejects.toThrow('project ID is invalid');
    await expect(updateCashflowExecutiveApprover({ ...base, projectId: 'project-a', expectedVersion: -1 }))
      .rejects.toThrow('expected version is invalid');
    await expect(updateCashflowExecutiveApprover({ ...base, projectId: 'project-a', reason: '   ' }))
      .rejects.toThrow('reason is invalid');
    expect(client.patch).not.toHaveBeenCalled();
  });

  it('sends server-owned expected evidence and explicit reason to the idempotent recovery command', async () => {
    const result: CashflowCumulativeCloseHeadRecoveryResponse = {
      projectId: 'project-a',
      status: 'RECOVERED',
      statusLabel: '누적 마감 권한 복구 완료',
      recoveryAction: 'REPAIRED',
      changed: true,
      replayed: false,
      guide: '정책 상태를 다시 불러와 주세요.',
    };
    const client = { post: vi.fn().mockResolvedValue({ data: result }) } as any;
    const expectedEvidence = {
      contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1' as const,
      authorityFingerprint: `sha256:${'a'.repeat(64)}`,
      monthlyCloseId: 'project-a-2026-08',
      monthlyCloseVersionId: 'project-a-2026-08-r1',
      requestId: 'project-a-2026-08',
      monthlyCloseRevision: 1,
      requestRevision: 1,
      sourceRevision: `sha256:${'b'.repeat(64)}`,
      snapshotHash: `sha256:${'c'.repeat(64)}`,
      rootHash: `sha256:${'d'.repeat(64)}`,
      headRevision: 4,
    };

    await expect(recoverCashflowCumulativeCloseHead({
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a', role: 'admin', idToken: 'token-a' },
      projectId: 'project-a',
      reason: '손상 authority exact 복구',
      expectedEvidence,
      idempotencyKey: 'recover-project-a-evidence-a',
      client,
    })).resolves.toBe(result);

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-head-recovery',
      {
        tenantId: 'tenant-a',
        actor: { id: 'admin-a', email: undefined, role: 'admin', idToken: 'token-a' },
        body: { reason: '손상 authority exact 복구', expectedEvidence },
        idempotencyKey: 'recover-project-a-evidence-a',
        retries: 0,
        timeoutMs: 20_000,
      },
    );
  });

  it('rejects an empty recovery reason or malformed expected evidence before the API call', async () => {
    const client = { post: vi.fn() } as any;
    const base = {
      tenantId: 'tenant-a', actor: { uid: 'admin-a' }, projectId: 'project-a',
      reason: '복구 사유', idempotencyKey: 'recover-safe', client,
    };

    await expect(recoverCashflowCumulativeCloseHead({
      ...base,
      reason: '   ',
      expectedEvidence: {} as any,
    })).rejects.toThrow('reason is invalid');
    await expect(recoverCashflowCumulativeCloseHead({
      ...base,
      expectedEvidence: { contractVersion: 'wrong' } as any,
    })).rejects.toThrow('expected evidence is invalid');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('sends only server-owned opaque cycle evidence to the reset-to-reclose command', async () => {
    const result: CashflowCumulativeCloseResetToRecloseResponse = {
      projectId: 'project-a',
      yearMonth: '2026-08',
      status: 'RESET_TO_RECLOSE_COMPLETED',
      statusLabel: '재결산 준비 완료',
      guide: '정상 월결산을 다시 진행해 주세요.',
      nextAction: {
        type: 'REVIEW_SHEET_AND_RECLOSE',
        label: '시트 검증본 다시 검토',
        href: '/portal/cashflow/project-a/sheets-lab',
      },
    };
    const expectedEvidence = {
      contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1' as const,
      authorityFingerprint: `sha256:${'a'.repeat(64)}`,
      monthlyCloseFingerprint: `sha256:${'b'.repeat(64)}`,
      immutableEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
      monthlyCloseId: 'project-a-2026-08',
      yearMonth: '2026-08',
    };
    const client = { post: vi.fn().mockResolvedValue({ data: result }) } as any;

    await expect(resetCashflowCumulativeCloseToReclose({
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a', role: 'admin', idToken: 'token-a' },
      projectId: 'project-a',
      reason: '손상 authority와 현재 header 감사 격리',
      expectedEvidence,
      idempotencyKey: 'reset-reclose-project-a-evidence-a',
      client,
    })).resolves.toBe(result);

    expect(client.post).toHaveBeenCalledWith(
      '/api/v1/admin/cashflow-period-policy/projects/project-a/cumulative-close-reset-to-reclose',
      {
        tenantId: 'tenant-a',
        actor: { id: 'admin-a', email: undefined, role: 'admin', idToken: 'token-a' },
        body: { reason: '손상 authority와 현재 header 감사 격리', expectedEvidence },
        idempotencyKey: 'reset-reclose-project-a-evidence-a',
        retries: 0,
        timeoutMs: 20_000,
      },
    );
  });

  it('rejects malformed reset-to-reclose evidence without calling the API', async () => {
    const client = { post: vi.fn() } as any;
    await expect(resetCashflowCumulativeCloseToReclose({
      tenantId: 'tenant-a',
      actor: { uid: 'admin-a' },
      projectId: 'project-a',
      reason: '손상 authority 격리',
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1',
        authorityFingerprint: 'raw-value',
        monthlyCloseFingerprint: `sha256:${'b'.repeat(64)}`,
        immutableEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
        monthlyCloseId: 'project-a-2026-08',
        yearMonth: '2026-08',
      },
      idempotencyKey: 'reset-reclose-invalid',
      client,
    })).rejects.toThrow('reset-to-reclose evidence is invalid');
    expect(client.post).not.toHaveBeenCalled();
  });
});
