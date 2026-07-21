import { useEffect, useState } from 'react';
import { useAuth } from '../../data/auth-store';
import type { ProjectRequest } from '../../data/types';
import { useFirebase } from '../../lib/firebase-context';
import {
  fetchPendingProjectChangeRequestsViaBff,
  isPlatformApiEnabled,
} from '../../lib/platform-bff-client';

function buildPendingChangeMap(requests: ProjectRequest[]): Map<string, ProjectRequest> {
  const next = new Map<string, ProjectRequest>();
  requests.forEach((request) => {
    if (request.requestKind !== 'CHANGE') return;
    const projectId = request.targetProjectId || request.approvedProjectId;
    if (!projectId) return;
    const previous = next.get(projectId);
    if (!previous || String(request.requestedAt || '').localeCompare(String(previous.requestedAt || '')) > 0) {
      next.set(projectId, request);
    }
  });
  return next;
}

export function usePendingProjectChangeRequests(projectIds: string[]): Map<string, ProjectRequest> {
  const { orgId } = useFirebase();
  const { user } = useAuth();
  const [pendingProjectChangeMap, setPendingProjectChangeMap] = useState<Map<string, ProjectRequest>>(new Map());

  useEffect(() => {
    if (!user?.uid || !isPlatformApiEnabled()) {
      setPendingProjectChangeMap(new Map());
      return undefined;
    }
    let disposed = false;
    const load = async () => {
      try {
        const requests = await fetchPendingProjectChangeRequestsViaBff({
          tenantId: orgId,
          projectIds,
          actor: {
            uid: user.uid,
            email: user.email,
            role: user.role,
            idToken: user.idToken,
          },
        });
        if (!disposed) setPendingProjectChangeMap(buildPendingChangeMap(requests));
      } catch (error) {
        console.error('[usePendingProjectChangeRequests] BFF fetch failed:', error);
        if (!disposed) setPendingProjectChangeMap(new Map());
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      disposed = true;
      window.removeEventListener('focus', load);
    };
  }, [orgId, projectIds, user?.email, user?.idToken, user?.role, user?.uid]);

  return pendingProjectChangeMap;
}
