import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { getOrgRootPath } from '../lib/firebase';
import { useFirebase } from '../lib/firebase-context';
import {
  ORGANIZATION_SETTINGS_PATH,
  buildOrganizationSettingsDoc,
  buildDefaultOrganizationGroups,
  resolveOrganizationGroups,
  type OrganizationGroup,
} from './organization-settings';

/** 조직 목록 구독. 설정 문서가 없으면 기본 조직으로 시작한다 — 빈 드롭다운을 보이지 않게. */
export function useOrganizationSettings() {
  const { db, isOnline, orgId } = useFirebase();
  const [groups, setGroups] = useState<OrganizationGroup[]>(() => buildDefaultOrganizationGroups());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !isOnline || !orgId) {
      setGroups(buildDefaultOrganizationGroups());
      return undefined;
    }
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, `${getOrgRootPath(orgId)}/${ORGANIZATION_SETTINGS_PATH}`),
      (snapshot) => {
        setGroups(resolveOrganizationGroups(snapshot.exists() ? snapshot.data() : null));
        setIsLoading(false);
        setError(null);
      },
      (snapshotError) => {
        setIsLoading(false);
        setError(snapshotError instanceof Error ? snapshotError.message : '조직 목록을 불러오지 못했습니다.');
      },
    );
    return unsubscribe;
  }, [db, isOnline, orgId]);

  const saveGroups = useCallback(async (next: OrganizationGroup[], actorId?: string) => {
    if (!db || !orgId) throw new Error('Firestore 연결이 필요합니다.');
    await setDoc(
      doc(db, `${getOrgRootPath(orgId)}/${ORGANIZATION_SETTINGS_PATH}`),
      buildOrganizationSettingsDoc({ groups: next, actorId }),
      { merge: false },
    );
  }, [db, orgId]);

  return { groups, isLoading, error, saveGroups };
}
