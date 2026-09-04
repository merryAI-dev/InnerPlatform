import { describe, expect, it, vi } from 'vitest';

import {
  mintFirebaseCanaryIdToken,
  validateSettlementCandidateCanaryOptions,
  verifyCashflowSettlementCandidate,
} from '../scripts/verify-cashflow-settlement-candidate.mjs';

const base = {
  baseUrl: 'https://candidate.vercel.app',
  firebaseWebApiKey: 'public-web-api-key',
  firebaseRefreshToken: 'dedicated-read-only-refresh-token',
  tenantId: 'mysc',
  actorUid: 'canary-reader',
  projectId: 'project-a',
  cycleYearMonth: '2026-09',
  expectedRequestId: 'project-a-2026-09',
  expectedStatus: 'PENDING_APPROVAL',
  expectedWorkflowRevision: '3',
  expectedEvidenceRevision: '2',
  expectedTargetYearMonth: '2026-08',
  expectedActions: 'withdrawRequest',
  protectionBypass: 'bypass-secret',
  canonicalOrigin: 'https://myscube.myscguard.app',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('cashflow settlement Vercel candidate canary', () => {
  it('requires exact origins, identities, and cycle scope', () => {
    expect(validateSettlementCandidateCanaryOptions(base)).toMatchObject({
      baseUrl: 'https://candidate.vercel.app', tenantId: 'mysc', cycleYearMonth: '2026-09',
    });
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, baseUrl: 'http://candidate.test/path' }))
      .toThrow(/exact HTTPS origin/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, cycleYearMonth: '2026-13' }))
      .toThrow(/YYYY-MM/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedRequestId: '' }))
      .toThrow(/expectedRequestId/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedEvidenceRevision: '0' }))
      .toThrow(/expectedEvidenceRevision/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedWorkflowRevision: '3.0' }))
      .toThrow(/expectedWorkflowRevision/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedActions: '' }))
      .toThrow(/expectedActions/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedRequestId: 'other-request' }))
      .toThrow(/projectId-cycleYearMonth/);
    expect(() => validateSettlementCandidateCanaryOptions({ ...base, expectedTargetYearMonth: '2026-07' }))
      .toThrow(/previous month/);
  });

  it('exchanges only the dedicated refresh token and binds the returned Firebase uid', async () => {
    const fetchImpl = vi.fn(async () => response({
      user_id: 'canary-reader', id_token: 'firebase-id-token', refresh_token: 'rotated-token',
    }));
    await expect(mintFirebaseCanaryIdToken(validateSettlementCandidateCanaryOptions(base), fetchImpl))
      .resolves.toBe('firebase-id-token');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://securetoken.googleapis.com/v1/token?key=public-web-api-key',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
      }),
    );
    expect(String(fetchImpl.mock.calls[0][1].body)).toContain('grant_type=refresh_token');
    expect(String(fetchImpl.mock.calls[0][1].body)).toContain('refresh_token=dedicated-read-only-refresh-token');
  });

  it('checks the authenticated canonical detail read and its month state', async () => {
    const canonicalRequest = {
      projectId: 'project-a', requestId: 'project-a-2026-09', status: 'PENDING_APPROVAL',
      workflowRevision: 3, evidenceRevision: 2, monthCloseTargetYearMonth: '2026-08',
      cycleYearMonth: '2026-09', documentType: 'MONTHLY_CLOSE',
      contractVersion: 'cashflow-cumulative-close-v2',
    };
    const fetchImpl = vi.fn(async (url, init) => {
      expect(init.headers.authorization).toBe('Bearer firebase-id-token');
      expect(init.headers['x-tenant-id']).toBe('mysc');
      expect(init.headers['x-vercel-protection-bypass']).toBe('bypass-secret');
      expect(init.redirect).toBe('error');
      return response({
        projectId: 'project-a', yearMonth: '2026-09',
        settlementCycle: {
          cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
        },
        monthState: canonicalRequest,
        actions: {
          withdrawRequest: { enabled: false },
          cumulativeScope: { ready: true, guide: '' },
        },
      });
    });
    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl,
      mintIdToken: async () => 'firebase-id-token',
    })).resolves.toEqual({
      ok: true, projectId: 'project-a', cycleYearMonth: '2026-09', requestPresent: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(
      'https://candidate.vercel.app/api/v1/cashflow/project-a/month-close?yearMonth=2026-09',
    );
  });

  it('rejects an empty month state instead of accepting any healthy project', async () => {
    const emptyFetch = vi.fn(async () => response({
      projectId: 'project-a', yearMonth: '2026-09',
      settlementCycle: {
        cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
      },
      monthState: null, actions: {},
    }));
    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl: emptyFetch, mintIdToken: async () => 'token',
    })).rejects.toThrow(/fixed settlement fixture/);
  });

  it('rejects a healthy read whose request does not match the approved fixture', async () => {
    const wrongFixture = {
      projectId: 'project-a', requestId: 'project-a-2026-09', status: 'APPROVED',
      workflowRevision: 3, evidenceRevision: 3, monthCloseTargetYearMonth: '2026-08',
      cycleYearMonth: '2026-09', documentType: 'MONTHLY_CLOSE',
      contractVersion: 'cashflow-cumulative-close-v2',
    };
    const fetchImpl = vi.fn(async () => response({
      projectId: 'project-a', yearMonth: '2026-09',
      settlementCycle: {
        cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
      },
      monthState: wrongFixture,
      actions: {},
    }));

    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl, mintIdToken: async () => 'token',
    })).rejects.toThrow(/fixed settlement fixture/);
  });

  it('rejects a canary principal that can mutate the fixed fixture', async () => {
    const request = {
      projectId: 'project-a', requestId: 'project-a-2026-09', status: 'PENDING_APPROVAL',
      workflowRevision: 3, evidenceRevision: 2, monthCloseTargetYearMonth: '2026-08',
      cycleYearMonth: '2026-09', documentType: 'MONTHLY_CLOSE',
      contractVersion: 'cashflow-cumulative-close-v2',
    };
    const fetchImpl = vi.fn(async () => response({
      projectId: 'project-a', yearMonth: '2026-09',
      settlementCycle: {
        cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
      },
      monthState: request,
      actions: { approveMonthClose: { enabled: true } },
    }));

    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl, mintIdToken: async () => 'token',
    })).rejects.toThrow(/read-only/);
  });

  it('rejects coerced revisions and malformed action decisions', async () => {
    const request = {
      projectId: 'project-a', requestId: 'project-a-2026-09', status: 'PENDING_APPROVAL',
      workflowRevision: '3', evidenceRevision: 2, monthCloseTargetYearMonth: '2026-08',
      cycleYearMonth: '2026-09', documentType: 'MONTHLY_CLOSE',
      contractVersion: 'cashflow-cumulative-close-v2',
    };
    const coercedRevisionFetch = vi.fn(async () => response({
      projectId: 'project-a', yearMonth: '2026-09',
      settlementCycle: {
        cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
      },
      monthState: request,
      actions: { withdrawRequest: { enabled: false } },
    }));
    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl: coercedRevisionFetch, mintIdToken: async () => 'token',
    })).rejects.toThrow(/fixed settlement fixture/);

    const integerRequest = { ...request, workflowRevision: 3 };
    const malformedActionFetch = vi.fn(async () => response({
      projectId: 'project-a', yearMonth: '2026-09',
      settlementCycle: {
        cycleYearMonth: '2026-09', monthCloseTargetYearMonth: '2026-08', health: 'OK',
      },
      monthState: integerRequest,
      actions: { withdrawRequest: { enabled: false }, approveMonthClose: {} },
    }));
    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl: malformedActionFetch, mintIdToken: async () => 'token',
    })).rejects.toThrow(/read-only/);
  });

  it('fails without exposing an upstream response body when auth or reads fail', async () => {
    const fetchImpl = vi.fn(async () => response({ idToken: 'sensitive', persons: ['pii'] }, 403));
    await expect(verifyCashflowSettlementCandidate(base, {
      fetchImpl, mintIdToken: async () => 'token',
    })).rejects.toThrow('Settlement detail canary failed with HTTP 403.');
  });
});
