import { describe, expect, it, vi } from 'vitest';
import { createCashflowPrivateDraftClient } from './cashflow-private-draft-client';

const draft = {
  projectId: 'project-a',
  resourceType: 'cashflow',
  resourceId: 'project-a',
  draftRevision: 1,
  payload: { drafts: { '2026-07:projection:1:sales': '1200' } },
  status: 'ACTIVE',
};

describe('cashflow private draft client', () => {
  it('keeps temporary snapshots on the private route with exact lease ownership headers', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ data: { draft } }),
      post: vi.fn()
        .mockResolvedValueOnce({ data: { draft } })
        .mockResolvedValueOnce({ data: { draft: { ...draft, draftRevision: 3, status: 'SUBMITTED' } } }),
      patch: vi.fn().mockResolvedValue({ data: { draft: { ...draft, draftRevision: 2 } } }),
    } as any;
    const api = createCashflowPrivateDraftClient({
      tenantId: 'tenant-a',
      projectId: 'project-a',
      sessionId: '11111111-1111-4111-8111-111111111111',
      actor: { uid: 'user-a', idToken: 'token' },
      client,
    });
    const lease = { leaseId: 'lease-a', fence: 7 };

    await api.get();
    await api.open(lease);
    await api.save(lease, { expectedDraftRevision: 1, payload: draft.payload });
    const completed = await api.complete(lease, { expectedDraftRevision: 2 });
    expect(completed.draft).toMatchObject({ draftRevision: 3, status: 'SUBMITTED' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/cashflow-edit-drafts/project-a', expect.objectContaining({
      headers: { 'x-edit-session-id': '11111111-1111-4111-8111-111111111111' },
    }));
    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/cashflow-edit-drafts/project-a/open', expect.objectContaining({
      headers: {
        'x-edit-session-id': '11111111-1111-4111-8111-111111111111',
        'x-edit-lease-id': 'lease-a',
        'x-edit-fence': '7',
      },
      body: { baseSnapshot: {}, payload: {} },
    }));
    expect(client.patch).toHaveBeenCalledWith('/api/v1/cashflow-edit-drafts/project-a', expect.objectContaining({
      body: { expectedDraftRevision: 1, payload: draft.payload },
    }));
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/cashflow-edit-drafts/project-a/complete', expect.objectContaining({
      body: { expectedDraftRevision: 2 },
    }));
  });

  it('rejects unsafe project and fence values before a request', async () => {
    expect(() => createCashflowPrivateDraftClient({
      tenantId: 'tenant-a', actor: { uid: 'user-a' }, sessionId: 'session-a', projectId: '../bad', client: {} as any,
    })).toThrow('project ID is invalid');
    const api = createCashflowPrivateDraftClient({
      tenantId: 'tenant-a', actor: { uid: 'user-a' }, sessionId: 'session-a', projectId: 'project-a', client: {} as any,
    });
    await expect(api.open({ leaseId: 'lease-a', fence: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow('valid cashflow edit lease');
  });
});
