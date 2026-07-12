import { describe, expect, it } from 'vitest';
import {
  cashflowEditLeaseResource,
  cashflowMutationHeaders,
  toCashflowMutationLease,
} from './cashflow-edit-lease';

describe('cashflow edit lease boundary', () => {
  it('uses the same project-scoped resource for cashflow and sheet lab', () => {
    expect(cashflowEditLeaseResource(' project-a ')).toEqual({
      resourceType: 'cashflow',
      resourceId: 'project-a',
      resourceKey: 'cashflow:project-a',
    });
    expect(cashflowEditLeaseResource('project-b').resourceKey).toBe('cashflow:project-b');
  });

  it.each(['', '   ', 'project/a'])('rejects an invalid project id %j', (projectId) => {
    expect(() => cashflowEditLeaseResource(projectId)).toThrow();
  });

  it('forwards only the exact tab session and current ownership headers', () => {
    const lease = toCashflowMutationLease('session-a', { leaseId: 'lease-a', fence: 7 });
    expect(cashflowMutationHeaders(lease)).toEqual({
      'x-edit-session-id': 'session-a',
      'x-edit-lease-id': 'lease-a',
      'x-edit-fence': '7',
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe fence %s', (fence) => {
    expect(() => cashflowMutationHeaders({ sessionId: 'session-a', leaseId: 'lease-a', fence })).toThrow();
  });

  it.each([
    { sessionId: '', leaseId: 'lease-a', fence: 1 },
    { sessionId: ' session-a ', leaseId: 'lease-a', fence: 1 },
    { sessionId: 'session-a', leaseId: '', fence: 1 },
  ])('rejects malformed lease identity %#', (lease) => {
    expect(() => cashflowMutationHeaders(lease)).toThrow();
  });
});
