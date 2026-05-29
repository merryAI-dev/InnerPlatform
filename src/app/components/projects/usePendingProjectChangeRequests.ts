import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import type { ProjectRequest } from '../../data/types';
import { getOrgRootPath } from '../../lib/firebase';
import { useFirebase } from '../../lib/firebase-context';

type ProjectRequestCollectionName = 'project_requests' | 'projectRequests';

const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests'];

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

export function usePendingProjectChangeRequests(): Map<string, ProjectRequest> {
  const { db, isOnline, orgId } = useFirebase();
  const [pendingProjectChangeMap, setPendingProjectChangeMap] = useState<Map<string, ProjectRequest>>(new Map());

  useEffect(() => {
    if (!db || !isOnline) {
      setPendingProjectChangeMap(new Map());
      return undefined;
    }

    const collectionRows = new Map<ProjectRequestCollectionName, ProjectRequest[]>();
    const publish = () => {
      setPendingProjectChangeMap(buildPendingChangeMap(Array.from(collectionRows.values()).flat()));
    };

    const unsubscribes = PROJECT_REQUEST_COLLECTIONS.map((collectionName) => {
      const q = query(
        collection(db, `${getOrgRootPath(orgId)}/${collectionName}`),
        where('status', '==', 'PENDING'),
      );
      return onSnapshot(q, (snapshot) => {
        collectionRows.set(collectionName, snapshot.docs.map((docSnap) => ({
          ...(docSnap.data() as ProjectRequest),
          id: docSnap.id,
        })));
        publish();
      }, (error) => {
        console.error(`[usePendingProjectChangeRequests] ${collectionName} listen failed:`, error);
        collectionRows.set(collectionName, []);
        publish();
      });
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [db, isOnline, orgId]);

  return pendingProjectChangeMap;
}
