import { describe, expect, it } from 'vitest';
import {
  buildStandardHeaders,
  createRequestId,
  isMutationMethod,
} from './request-context';

describe('request-context helpers', () => {
  it('creates request ids with prefix', () => {
    expect(createRequestId('abc')).toMatch(/^abc_/);
  });

  it('detects mutation methods', () => {
    expect(isMutationMethod('POST')).toBe(true);
    expect(isMutationMethod('patch')).toBe(true);
    expect(isMutationMethod('GET')).toBe(false);
    expect(isMutationMethod(undefined)).toBe(false);
  });

  it('injects standard headers with idempotency key for mutation', () => {
    const headers = buildStandardHeaders({
      tenantId: 'mysc',
      actor: { id: 'u001', email: 'Admin@mysc.co.kr', role: 'admin' },
      method: 'POST',
      requestId: 'req-fixed',
    });

    expect(headers.get('x-request-id')).toBe('req-fixed');
    expect(headers.get('x-tenant-id')).toBe('mysc');
    expect(headers.get('x-actor-id')).toBe('u001');
    expect(headers.get('x-actor-email')).toBe('admin@mysc.co.kr');
    expect(headers.get('idempotency-key')).toMatch(/^idem_POST_u001_/);
  });

  it('does not force idempotency for read requests', () => {
    const headers = buildStandardHeaders({
      tenantId: 'mysc',
      actor: { id: 'u001' },
      method: 'GET',
      headers: { 'x-request-id': 'existing-id' },
    });

    expect(headers.get('x-request-id')).toBe('existing-id');
    expect(headers.get('idempotency-key')).toBeNull();
  });

  it('keeps explicit idempotency key and trims actor id', () => {
    const headers = buildStandardHeaders({
      tenantId: 'mysc',
      actor: { id: '  u001  ' },
      method: 'PATCH',
      idempotencyKey: 'idem-fixed',
    });

    expect(headers.get('x-actor-id')).toBe('u001');
    expect(headers.get('idempotency-key')).toBe('idem-fixed');
  });

  it('adds authorization header when id token exists', () => {
    const headers = buildStandardHeaders({
      tenantId: 'mysc',
      actor: { id: 'u001', idToken: 'token-123' },
      method: 'GET',
    });

    expect(headers.get('authorization')).toBe('Bearer token-123');
  });
});
