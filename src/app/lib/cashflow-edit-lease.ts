export interface CashflowMutationLease {
  sessionId: string;
  leaseId: string;
  fence: number;
}

export function cashflowEditLeaseResource(projectId: string) {
  const resourceId = projectId.trim();
  if (!resourceId || resourceId.includes('/') || resourceId.length > 512) {
    throw new Error('A valid cashflow project id is required');
  }
  return {
    resourceType: 'cashflow' as const,
    resourceId,
    resourceKey: `cashflow:${resourceId}`,
  };
}

export function toCashflowMutationLease(
  sessionId: string,
  ownership: { leaseId: string; fence: number },
): CashflowMutationLease {
  const lease = { sessionId, leaseId: ownership.leaseId, fence: ownership.fence };
  cashflowMutationHeaders(lease);
  return lease;
}

export function cashflowMutationHeaders(lease: CashflowMutationLease): Record<string, string> {
  if (
    !lease.sessionId
    || lease.sessionId !== lease.sessionId.trim()
    || !lease.leaseId
    || lease.leaseId !== lease.leaseId.trim()
    || !Number.isSafeInteger(lease.fence)
    || lease.fence < 1
  ) {
    throw new Error('A valid cashflow edit lease is required');
  }
  return {
    'x-edit-session-id': lease.sessionId,
    'x-edit-lease-id': lease.leaseId,
    'x-edit-fence': String(lease.fence),
  };
}
