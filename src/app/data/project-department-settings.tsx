import { doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { getOrgRootPath } from '../lib/firebase';
import { useFirebase } from '../lib/firebase-context';
import { activeTeamLabels } from './organization-settings';
import { useOrganizationSettings } from './use-organization-settings';
import {
  PROJECT_DEPARTMENT_OPTIONS,
  dedupeProjectDepartmentLabels,
  buildProjectDepartmentSettingsOptions,
  resolveProjectDepartmentSettingsOptions,
  type ProjectDepartmentSettingsOption,
} from './project-department-options';

export const PROJECT_DEPARTMENT_SETTINGS_DOC_ID = 'project-departments';
export const PROJECT_DEPARTMENT_SETTINGS_PATH = `settings/${PROJECT_DEPARTMENT_SETTINGS_DOC_ID}`;

export interface ProjectDepartmentSettingsDoc {
  options: ProjectDepartmentSettingsOption[];
  updatedAt?: string;
  updatedBy?: string;
  version: 1;
}

function settingsDocRef(db: Firestore, orgId: string) {
  return doc(db, `${getOrgRootPath(orgId)}/${PROJECT_DEPARTMENT_SETTINGS_PATH}`);
}

export function buildProjectDepartmentSettingsDoc(input: {
  labels: unknown[];
  actorId?: string;
  now?: string;
}): ProjectDepartmentSettingsDoc {
  return {
    options: buildProjectDepartmentSettingsOptions(input.labels),
    updatedAt: input.now || new Date().toISOString(),
    updatedBy: input.actorId || 'system',
    version: 1,
  };
}

export async function saveProjectDepartmentSettings(
  db: Firestore,
  orgId: string,
  labels: unknown[],
  actorId?: string,
): Promise<void> {
  await setDoc(
    settingsDocRef(db, orgId),
    buildProjectDepartmentSettingsDoc({ labels, actorId }),
    { merge: false },
  );
}

/**
 * 프로젝트 담당조직 선택지.
 *
 * 뿌리는 조직 목록(settings/organizations)이다 - 조직 개편을 두 곳에서 따로 고치면
 * CIC1 이 한쪽에만 남는다. 예전 담당조직 문서에만 있던 값은 지우지 않고 함께 보여 주다가,
 * 설정 화면에서 정리한다.
 */
export function useProjectDepartmentSettings() {
  const { db, isOnline, orgId } = useFirebase();
  const { groups } = useOrganizationSettings();
  const [options, setOptions] = useState<string[]>(() => resolveProjectDepartmentSettingsOptions(null));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !isOnline || !orgId) {
      setOptions(resolveProjectDepartmentSettingsOptions(null));
      setIsLoading(false);
      setError(null);
      return undefined;
    }

    setIsLoading(true);
    return onSnapshot(settingsDocRef(db, orgId), (snapshot) => {
      setOptions(resolveProjectDepartmentSettingsOptions(snapshot.exists() ? snapshot.data() : null));
      setIsLoading(false);
      setError(null);
    }, (snapshotError) => {
      console.error('[ProjectDepartmentSettings] listen failed:', snapshotError);
      setOptions(resolveProjectDepartmentSettingsOptions(null));
      setIsLoading(false);
      setError(snapshotError instanceof Error ? snapshotError.message : '조직/소속 옵션을 불러오지 못했습니다.');
    });
  }, [db, isOnline, orgId]);

  const saveOptions = useMemo(() => async (labels: unknown[], actorId?: string) => {
    if (!db || !orgId) {
      throw new Error('Firestore 연결이 필요합니다.');
    }
    await saveProjectDepartmentSettings(db, orgId, labels, actorId);
  }, [db, orgId]);

  // 조직 트리의 활성 팀이 먼저 오고, 예전 문서에만 있던 값이 뒤에 붙는다.
  const mergedOptions = useMemo(
    () => dedupeProjectDepartmentLabels(['미지정', ...activeTeamLabels(groups), ...options]),
    [groups, options],
  );

  return {
    options: mergedOptions,
    isLoading,
    error,
    saveOptions,
    fallbackOptions: [...PROJECT_DEPARTMENT_OPTIONS],
  };
}
