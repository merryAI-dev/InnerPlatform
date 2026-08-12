import { describe, expect, it, vi } from 'vitest';
import { readCashflowStatus, resolveCashflowMcpConfig } from './cashflow-status.mjs';

const input = {
  baseUrl: 'https://myscube.myscguard.app',
  accessToken: 'oauth-token',
  projectIds: ['project-a'],
  yearMonth: '2026-08',
  requestId: 'request-1',
};

function okResponse() {
  return new Response(JSON.stringify({
    version: '1',
    yearMonth: '2026-08',
    items: [{ projectId: 'project-a', settlementStatuses: null, projectionActualSummary: null }],
    errors: [],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('readCashflowStatus', () => {
  it('uses the OAuth-only read endpoint without actor or tenant headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await readCashflowStatus({ ...input, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://myscube.myscguard.app/api/v1/mcp/cashflow/weekly-overview');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      authorization: 'Bearer oauth-token',
      'content-type': 'application/json',
      'x-request-id': 'request-1',
    });
  });

  it('rejects invalid input before making a request', async () => {
    const fetchImpl = vi.fn();

    await expect(readCashflowStatus({ ...input, projectIds: ['bad/id'], fetchImpl })).rejects.toThrow('프로젝트 식별자');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('needs no Firebase ID token environment variable', async () => {
    expect(resolveCashflowMcpConfig({ MYSCUBE_BFF_BASE_URL: input.baseUrl })).toMatchObject({ baseUrl: `${input.baseUrl}/` });
  });

  it('does not expose the token when BFF denies access', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.toThrow('조회할 권한');
    await expect(readCashflowStatus({ ...input, fetchImpl })).rejects.not.toThrow('oauth-token');
  });
});
