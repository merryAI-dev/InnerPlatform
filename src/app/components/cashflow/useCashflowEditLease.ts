import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createEditLeaseClient,
  type EditLeaseClient,
} from '../../lib/edit-lease-client';
import {
  cashflowEditLeaseResource,
  toCashflowMutationLease,
  type CashflowMutationLease,
} from '../../lib/cashflow-edit-lease';
import type { ActorLike } from '../../lib/platform-bff-client';
import { openEditSession, type EditSession } from '../../platform/edit-session';
import { useEditLease } from '../editing/useEditLease';

const UNAVAILABLE_CLIENT: EditLeaseClient = {
  getStatus: async () => { throw new Error('수정 세션을 준비하고 있습니다.'); },
  acquire: async () => { throw new Error('수정 세션을 준비하고 있습니다.'); },
  takeover: async () => { throw new Error('수정 세션을 준비하고 있습니다.'); },
  extend: async () => { throw new Error('수정 세션을 준비하고 있습니다.'); },
  release: async () => { throw new Error('수정 세션을 준비하고 있습니다.'); },
};

export function formatLeaseRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function useCashflowEditLease(options: {
  tenantId: string;
  projectId: string;
  actor: ActorLike;
}) {
  const [session, setSession] = useState<EditSession | null>(null);
  const validProjectId = options.projectId.trim();

  useEffect(() => {
    let active = true;
    let opened: EditSession | null = null;
    void openEditSession().then((next) => {
      opened = next;
      if (active) setSession(next);
      else next.dispose();
    });
    return () => {
      active = false;
      opened?.dispose();
    };
  }, []);

  const resource = useMemo(
    () => cashflowEditLeaseResource(validProjectId || '__unselected__'),
    [validProjectId],
  );
  const client = useMemo(() => {
    if (!session || !validProjectId || !options.actor.idToken) return UNAVAILABLE_CLIENT;
    return createEditLeaseClient({
      tenantId: options.tenantId,
      actor: options.actor,
      sessionId: session.sessionId,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
    });
  }, [
    options.actor.email,
    options.actor.googleAccessToken,
    options.actor.idToken,
    options.actor.role,
    options.actor.uid,
    options.tenantId,
    resource.resourceId,
    resource.resourceType,
    session,
    validProjectId,
  ]);
  const lease = useEditLease({ client });

  useEffect(() => {
    if (session && validProjectId) void lease.checkStatus();
  }, [client, session, validProjectId]);

  const checkBeforeMutation = useCallback(async (): Promise<CashflowMutationLease> => {
    const ownership = await lease.checkBeforeSave();
    if (!validProjectId || !session || !ownership) {
      throw new Error('수정 세션이 없거나 종료되었습니다. 다시 수정하기를 눌러 주세요.');
    }
    return toCashflowMutationLease(session.sessionId, ownership);
  }, [lease.checkBeforeSave, session, validProjectId]);

  return {
    ...lease,
    resourceKey: resource.resourceKey,
    sessionId: session?.sessionId || null,
    remainingLabel: formatLeaseRemaining(lease.remainingMs),
    checkBeforeMutation,
  };
}
