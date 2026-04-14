import { describe, expect, it, vi } from 'vitest';
import { resolveApiRequestContext } from './app.mjs';

function createReq(headers: Record<string, string>, method: string = 'PATCH') {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    normalized.set(key.toLowerCase(), value);
  }
  return {
    method,
    header(name: string) {
      return normalized.get(name.toLowerCase());
    },
  };
}

describe('resolveApiRequestContext', () => {
  it('prefers member role over firebase token role for final RBAC', async () => {
    const req = createReq({
      authorization: 'Bearer token',
      'x-tenant-id': 'mysc',
      'x-actor-id': 'u-member',
      'idempotency-key': 'idem-request-context-role',
    });

    const context = await resolveApiRequestContext(req as any, {
      authMode: 'firebase_required',
      verifyToken: vi.fn(async () => ({
        uid: 'u-member',
        tenantId: 'mysc',
        role: 'pm',
        email: 'member@mysc.co.kr',
      })),
      resolveMemberIdentity: vi.fn(async () => ({
        role: 'admin',
        email: 'member@mysc.co.kr',
      })),
    });

    expect(context.actorRole).toBe('admin');
    expect(context.actorEmail).toBe('member@mysc.co.kr');
  });
});
