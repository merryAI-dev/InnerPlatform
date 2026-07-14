import { describe, expect, it, vi } from 'vitest';
import { PlatformApiClient, PlatformApiError } from '../platform/api-client';
import {
  createEditLeaseClient,
  EditLeaseClientError,
  EditLeaseProtocolError,
  type EditLeaseApiClient,
} from './edit-lease-client';

const OWNED = {
  serverNow: '2026-07-10T00:00:00.000Z',
  state: 'ACTIVE' as const,
  canEdit: true as const,
  expiresAt: '2026-07-10T00:30:00.000Z',
  leaseId: 'lease-a',
  fence: 7,
};

const RELEASED = {
  serverNow: '2026-07-10T00:05:00.000Z',
  state: 'RELEASED' as const,
  canEdit: false as const,
  expiresAt: '2026-07-10T00:30:00.000Z',
};

function scopedClient(apiClient: EditLeaseApiClient) {
  return createEditLeaseClient({
    tenantId: 'mysc',
    actor: { uid: 'actor-a', role: 'pm', idToken: 'token-a' },
    sessionId: '11111111-1111-4111-8111-111111111111',
    resourceType: 'project-info',
    resourceId: 'project 한글',
    client: apiClient,
  });
}

describe('edit lease client', () => {
  it('calls status/acquire/takeover/extend/release with the exact session and ownership headers', async () => {
    const apiClient = {
      get: vi.fn(async () => ({ data: OWNED })),
      post: vi.fn()
        .mockResolvedValueOnce({ data: OWNED })
        .mockResolvedValueOnce({ data: { ...OWNED, leaseId: 'lease-b', fence: 8 } })
        .mockResolvedValueOnce({ data: OWNED })
        .mockResolvedValueOnce({ data: RELEASED }),
    } as unknown as EditLeaseApiClient;
    const client = scopedClient(apiClient);

    await client.getStatus();
    const acquired = await client.acquire();
    await client.takeover();
    await client.extend(acquired);
    await client.release(acquired);

    const path = '/api/v1/edit-leases/project-info/project%20%ED%95%9C%EA%B8%80';
    expect(apiClient.get).toHaveBeenCalledWith(path, expect.objectContaining({
      headers: { 'x-edit-session-id': '11111111-1111-4111-8111-111111111111' },
    }));
    expect(apiClient.post).toHaveBeenNthCalledWith(1, `${path}/acquire`, expect.objectContaining({
      headers: { 'x-edit-session-id': '11111111-1111-4111-8111-111111111111' },
    }));
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `${path}/takeover`, expect.objectContaining({
      headers: { 'x-edit-session-id': '11111111-1111-4111-8111-111111111111' },
    }));
    expect(apiClient.post).toHaveBeenNthCalledWith(3, `${path}/extend`, expect.objectContaining({
      headers: {
        'x-edit-session-id': '11111111-1111-4111-8111-111111111111',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      },
    }));
    expect(apiClient.post).toHaveBeenNthCalledWith(4, `${path}/release`, expect.objectContaining({
      headers: {
        'x-edit-session-id': '11111111-1111-4111-8111-111111111111',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      },
    }));
    for (const [, options] of apiClient.post.mock.calls) {
      expect(options).not.toHaveProperty('idempotencyKey');
    }
  });

  it('uses a fresh PlatformApiClient idempotency key for every mutation', async () => {
    const idempotencyKeys: string[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      idempotencyKeys.push(new Headers(init?.headers).get('idempotency-key') || '');
      return new Response(JSON.stringify(OWNED), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = scopedClient(new PlatformApiClient({ fetchImpl }));

    await client.acquire();
    await client.acquire();

    expect(idempotencyKeys[0]).toMatch(/^idem_POST_actor-a_/);
    expect(idempotencyKeys[1]).toMatch(/^idem_POST_actor-a_/);
    expect(idempotencyKeys[1]).not.toBe(idempotencyKeys[0]);
  });

  it('fails closed when an owned response is missing its positive fence', async () => {
    const apiClient = {
      get: vi.fn(),
      post: vi.fn(async () => ({ data: { ...OWNED, fence: 0 } })),
    } as unknown as EditLeaseApiClient;

    await expect(scopedClient(apiClient).acquire()).rejects.toBeInstanceOf(EditLeaseProtocolError);
  });

  it('fails closed on string fences and non-canonical server timestamps', async () => {
    const stringFenceApi = {
      get: vi.fn(),
      post: vi.fn(async () => ({ data: { ...OWNED, fence: '7' } })),
    } as unknown as EditLeaseApiClient;
    await expect(scopedClient(stringFenceApi).acquire()).rejects.toBeInstanceOf(EditLeaseProtocolError);

    const looseTimestampApi = {
      get: vi.fn(),
      post: vi.fn(async () => ({ data: { ...OWNED, serverNow: '2026-07-10' } })),
    } as unknown as EditLeaseApiClient;
    await expect(scopedClient(looseTimestampApi).acquire()).rejects.toBeInstanceOf(EditLeaseProtocolError);
  });

  it('rejects slash resource IDs before issuing a request', () => {
    const apiClient = {
      get: vi.fn(),
      post: vi.fn(),
    } as unknown as EditLeaseApiClient;

    expect(() => createEditLeaseClient({
      tenantId: 'mysc',
      actor: { uid: 'actor-a', role: 'pm' },
      sessionId: '11111111-1111-4111-8111-111111111111',
      resourceType: 'project-info',
      resourceId: 'project/a',
      client: apiClient,
    })).toThrow(/resource/i);
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('maps a valid 423 holder response without exposing credentials', async () => {
    const apiClient = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new PlatformApiError('locked', 423, 'req-a', {
          error: 'edit_lease_held',
          details: {
            holderDisplayName: '김메리',
            sameActor: true,
            expiresAt: '2026-07-10T00:30:00.000Z',
            holderVersion: 'opaque-version-a',
          },
        });
      }),
    } as unknown as EditLeaseApiClient;

    await expect(scopedClient(apiClient).acquire()).rejects.toEqual(expect.objectContaining({
      name: 'EditLeaseClientError',
      status: 423,
      code: 'edit_lease_held',
      holder: {
        holderDisplayName: '김메리',
        sameActor: true,
        expiresAt: '2026-07-10T00:30:00.000Z',
        holderVersion: 'opaque-version-a',
      },
    } satisfies Partial<EditLeaseClientError>));
  });

  it('maps 410 expiry and rejects malformed 423 details', async () => {
    const expiredApi = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new PlatformApiError('expired', 410, 'req-expired', { error: 'edit_lease_expired' });
      }),
    } as unknown as EditLeaseApiClient;
    await expect(scopedClient(expiredApi).extend(OWNED)).rejects.toEqual(expect.objectContaining({
      status: 410,
      code: 'edit_lease_expired',
    }));

    const malformedApi = {
      get: vi.fn(),
      post: vi.fn(async () => {
        throw new PlatformApiError('locked', 423, 'req-locked', {
          error: 'edit_lease_held',
          details: { holderDisplayName: '', sameActor: 'yes', expiresAt: null },
        });
      }),
    } as unknown as EditLeaseApiClient;
    await expect(scopedClient(malformedApi).acquire()).rejects.toBeInstanceOf(EditLeaseProtocolError);
  });
});
