import { useEffect, useState } from 'react';
import { useAuth } from '../../data/auth-store';
import { useFirebase } from '../../lib/firebase-context';
import { featureFlags } from '../../config/feature-flags';
import { fetchMyHrProfileViaBff, type MyHrProfileResponse } from '../../lib/platform-bff-client';

/**
 * 내 인사정보.
 *
 * 학력·어학·자격의 단일 진실은 인력 명부(persons)다. 포털에서는 자기 것을 읽고,
 * 본인이 고치면 reload 로 다시 불러온다.
 */
export function useMyHrProfile() {
  const { user } = useAuth();
  const { orgId } = useFirebase();
  const [data, setData] = useState<MyHrProfileResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!featureFlags.platformApiEnabled || !user?.uid) {
      setData(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void fetchMyHrProfileViaBff({ tenantId: orgId, actor: user, signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setData(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('인사정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [orgId, user?.uid, user?.idToken, reloadToken]);

  return { data, loading, error, reload: () => setReloadToken((value) => value + 1) };
}
