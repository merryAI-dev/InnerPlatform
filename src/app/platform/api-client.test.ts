import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient, PlatformApiError } from './api-client';

describe('PlatformApiClient', () => {
  it('injects standard headers and parses json body', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-tenant-id')).toBe('mysc');
      expect(headers.get('x-actor-id')).toBe('u001');
      expect(headers.get('idempotency-key')).toMatch(/^idem_POST_u001_/);
      expect(headers.get('content-type')).toBe('application/json');

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-server',
        },
      });
    });

    const client = new PlatformApiClient({ baseUrl: 'https://api.example.com', fetchImpl });
    const response = await client.post<{ ok: boolean }>('/api/v1/projects', {
      tenantId: 'mysc',
      actor: { id: 'u001', role: 'admin' },
      body: { name: 'test' },
      requestId: 'req-client',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.requestId).toBe('req-server');
    expect(response.data.ok).toBe(true);
  });

  it('does not add idempotency for GET', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('idempotency-key')).toBeNull();

      return new Response('ok', {
        status: 200,
        headers: {
          'content-type': 'text/plain',
        },
      });
    });

    const client = new PlatformApiClient({ fetchImpl });
    const response = await client.get<string>('/api/v1/health', {
      tenantId: 'mysc',
      actor: { id: 'u001' },
    });

    expect(response.data).toBe('ok');
  });

  it('throws PlatformApiError on non-2xx responses', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'nope' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-denied',
        },
      });
    });

    const client = new PlatformApiClient({ fetchImpl });

    await expect(
      client.get('/api/v1/secure', {
        tenantId: 'mysc',
        actor: { id: 'u001' },
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PlatformApiError>>({
        name: 'PlatformApiError',
        status: 403,
        requestId: 'req-denied',
      }),
    );
  });

  it('retries transient failures and eventually succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const client = new PlatformApiClient({
      fetchImpl,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    const response = await client.get<{ ok: boolean }>('/api/v1/health', {
      tenantId: 'mysc',
      actor: { id: 'u001' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(response.data.ok).toBe(true);
  });

  it('does not retry client errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad request', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    }));

    const client = new PlatformApiClient({
      fetchImpl,
      maxRetries: 3,
      retryDelayMs: 0,
    });

    await expect(
      client.get('/api/v1/health', {
        tenantId: 'mysc',
        actor: { id: 'u001' },
      }),
    ).rejects.toBeInstanceOf(PlatformApiError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null for empty 204 responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {
      status: 204,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new PlatformApiClient({ fetchImpl });

    const response = await client.get<null>('/api/v1/health', {
      tenantId: 'mysc',
      actor: { id: 'u001' },
    });

    expect(response.data).toBeNull();
  });

  it('falls back to text when json parsing fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const client = new PlatformApiClient({ fetchImpl });

    const response = await client.get<string>('/api/v1/health', {
      tenantId: 'mysc',
      actor: { id: 'u001' },
    });

    expect(response.data).toBe('not-json');
  });
});
