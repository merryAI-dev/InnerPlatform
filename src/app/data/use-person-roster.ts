import { useEffect, useState } from 'react';
import { featureFlags } from '../config/feature-flags';
import { useFirebase } from '../lib/firebase-context';
import { fetchPersonsViaBff, type PersonRecord } from '../lib/platform-bff-client';
import type { DirectoryPerson } from '../platform/person-directory';
import { resolveEmploymentTypeAt } from '../platform/person-employment';
import { useAuth } from './auth-store';

/**
 * 인력 명부를 읽는다. 팀원 후보 목록의 안전망으로 쓴다.
 *
 * 포털 스토어의 members 는 [] 로 시작해서, 계정 목록이 오기 전까지 팀원 드롭다운이 빈다.
 * 그 사이를 명부로 메운다. 실패해도 던지지 않고 빈 배열을 돌려준다 - 명부를 못 읽었다고
 * 등록 화면이 막히면 안 된다.
 *
 * 한 번 읽은 결과는 모듈에 담아 둔다. 등록·수정 화면이 여러 번 열려도 다시 부르지 않는다.
 */

let cache: DirectoryPerson[] | null = null;
let inflight: Promise<DirectoryPerson[]> | null = null;

function toDirectoryPeople(items: PersonRecord[]): DirectoryPerson[] {
  return items.map((person) => ({
    personId: person.personId,
    name: person.name,
    nickname: person.nickname || '',
    employmentType: resolveEmploymentTypeAt(person.employments, today()),
  }));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 명부가 바뀌었을 때 다음 조회가 서버를 다시 보게 한다. */
export function resetPersonRosterCache(): void {
  cache = null;
  inflight = null;
}

export function usePersonRoster(enabled = true): DirectoryPerson[] {
  const { user: authUser } = useAuth();
  const { orgId } = useFirebase();
  const [roster, setRoster] = useState<DirectoryPerson[]>(() => cache || []);

  useEffect(() => {
    if (cache) {
      setRoster(cache);
      return undefined;
    }
    // enabled=false 면 읽지 않는다. 첫 화면에 필요 없는 곳(현금흐름 결재자 선택)이 뒤로 미룰 때 쓴다.
    if (!enabled || !featureFlags.platformApiEnabled || !authUser?.idToken) return undefined;

    let cancelled = false;
    if (!inflight) {
      inflight = fetchPersonsViaBff({ tenantId: orgId, actor: authUser })
        .then((response) => {
          cache = toDirectoryPeople(response.items || []);
          return cache;
        })
        .catch(() => {
          inflight = null;
          return [];
        });
    }
    void inflight.then((people) => {
      if (!cancelled) setRoster(people);
    });

    return () => { cancelled = true; };
  }, [enabled, orgId, authUser?.uid, authUser?.idToken]);

  return roster;
}
