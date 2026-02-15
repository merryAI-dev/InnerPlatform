import { describe, expect, it } from 'vitest';
import { buildTransactionStatePatch, withTenantScope } from './firestore-service';

describe('withTenantScope', () => {
  it('injects tenantId and removes undefined values', () => {
    const scoped = withTenantScope('mysc', {
      id: 'p001',
      name: 'project',
      optional: undefined,
    });

    expect(scoped).toEqual({
      id: 'p001',
      name: 'project',
      tenantId: 'mysc',
    });
  });
});

describe('buildTransactionStatePatch', () => {
  it('builds SUBMITTED transition payload', () => {
    const patch = buildTransactionStatePatch({
      orgId: 'mysc',
      newState: 'SUBMITTED',
      actorId: 'u001',
      now: '2026-02-14T10:00:00.000Z',
    });

    expect(patch).toEqual({
      state: 'SUBMITTED',
      updatedAt: '2026-02-14T10:00:00.000Z',
      updatedBy: 'u001',
      tenantId: 'mysc',
      submittedBy: 'u001',
      submittedAt: '2026-02-14T10:00:00.000Z',
    });
  });

  it('requires reason for REJECTED transition', () => {
    expect(() => buildTransactionStatePatch({
      orgId: 'mysc',
      newState: 'REJECTED',
      actorId: 'u001',
    })).toThrow(/requires a rejection reason/);
  });

  it('rejects unknown states', () => {
    expect(() => buildTransactionStatePatch({
      orgId: 'mysc',
      newState: 'INVALID',
      actorId: 'u001',
    })).toThrow(/Unsupported transaction state/);
  });
});
