import { doc, onSnapshot, setDoc, type Firestore } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { getOrgRootPath } from '../lib/firebase';
import { useFirebase } from '../lib/firebase-context';
import {
  PROJECT_DEPARTMENT_OPTIONS,
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

export function useProjectDepartmentSettings() {
  const { db, isOnline, orgId } = useFirebase();
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

  return {
    options,
    isLoading,
    error,
    saveOptions,
    fallbackOptions: [...PROJECT_DEPARTMENT_OPTIONS],
  };
}
