import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';
import { getOrgRootPath } from '../lib/firebase';
import { useFirebase } from '../lib/firebase-context';
import {
  PERSON_GRADE_SETTINGS_PATH,
  buildDefaultPersonGradeOptions,
  buildPersonGradeSettingsDoc,
  resolvePersonGradeOptions,
  type PersonGradeOption,
} from './person-grade-settings';

/** 직급 목록 구독. 설정 문서가 없으면 코드 카탈로그로 시작한다. */
export function usePersonGradeSettings() {
  const { db, isOnline, orgId } = useFirebase();
  const [grades, setGrades] = useState<PersonGradeOption[]>(() => buildDefaultPersonGradeOptions());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!db || !isOnline || !orgId) {
      setGrades(buildDefaultPersonGradeOptions());
      return undefined;
    }
    setIsLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, `${getOrgRootPath(orgId)}/${PERSON_GRADE_SETTINGS_PATH}`),
      (snapshot) => {
        setGrades(resolvePersonGradeOptions(snapshot.exists() ? snapshot.data() : null));
        setIsLoading(false);
        setError(null);
      },
      (snapshotError) => {
        setIsLoading(false);
        setError(snapshotError instanceof Error ? snapshotError.message : '직급 목록을 불러오지 못했습니다.');
      },
    );
    return unsubscribe;
  }, [db, isOnline, orgId]);

  const saveGrades = useCallback(async (next: PersonGradeOption[], actorId?: string) => {
    if (!db || !orgId) throw new Error('Firestore 연결이 필요합니다.');
    await setDoc(
      doc(db, `${getOrgRootPath(orgId)}/${PERSON_GRADE_SETTINGS_PATH}`),
      buildPersonGradeSettingsDoc({ grades: next, actorId }),
      { merge: false },
    );
  }, [db, orgId]);

  return { grades, isLoading, error, saveGrades };
}
