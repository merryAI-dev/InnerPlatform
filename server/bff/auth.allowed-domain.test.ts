import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRequestIdentity } from './auth.mjs';

function createHeaders(headers: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) normalized[k.toLowerCase()] = v;
  return (name: string) => normalized[name.toLowerCase()] || '';
}

describe('bff auth email allowlist', () => {
  const original = process.env.BFF_ALLOWED_EMAIL_DOMAINS;

  beforeEach(() => {
    process.env.BFF_ALLOWED_EMAIL_DOMAINS = 'mysc.co.kr';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.BFF_ALLOWED_EMAIL_DOMAINS;
    else process.env.BFF_ALLOWED_EMAIL_DOMAINS = original;
  });

  it('accepts allowed email domain', async () => {
    const identity = await resolveRequestIdentity({
      authMode: 'firebase_required',
      readHeaderValue: createHeaders({
        authorization: 'Bearer test-token',
        'x-tenant-id': 'mysc',
      }),
      verifyToken: async () => ({
        uid: 'u1',
        tenantId: 'mysc',
        role: 'pm',
        email: 'user@mysc.co.kr',
      }),
    });

    expect(identity.source).toBe('firebase');
    expect(identity.actorEmail).toBe('user@mysc.co.kr');
  });

  it('rejects disallowed email domain', async () => {
    await expect(resolveRequestIdentity({
      authMode: 'firebase_required',
      readHeaderValue: createHeaders({
        authorization: 'Bearer test-token',
        'x-tenant-id': 'mysc',
      }),
      verifyToken: async () => ({
        uid: 'u1',
        tenantId: 'mysc',
        role: 'pm',
        email: 'user@gmail.com',
      }),
    })).rejects.toMatchObject({ statusCode: 403, code: 'email_domain_not_allowed' });
  });

  it('rejects missing email in token', async () => {
    await expect(resolveRequestIdentity({
      authMode: 'firebase_required',
      readHeaderValue: createHeaders({
        authorization: 'Bearer test-token',
        'x-tenant-id': 'mysc',
      }),
      verifyToken: async () => ({
        uid: 'u1',
        tenantId: 'mysc',
        role: 'pm',
      }),
    })).rejects.toMatchObject({ statusCode: 403, code: 'missing_email' });
  });
});

