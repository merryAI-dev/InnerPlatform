/**
 * 이름 → 사람 식별자 조회 — 인력 명부(persons)에서 만든다.
 *
 * 프로젝트 배정에는 아직 personId 가 없고 이름 문자열만 있다. 그래서 지금은 이름으로
 * 동일인을 찾아야 하는데, 그 근거를 코드에 박힌 명부가 아니라 DB 명부에서 가져온다.
 * 배정에 personId 가 붙고 나면(리팩토링 2단계) 이 모듈은 통째로 사라지는 게 목표다.
 *
 * 디렉터리가 비어 있어도 절대 던지지 않는다. 명부를 못 불러왔다고 참여율 화면이
 * 막히면 안 된다 — 못 찾은 사람은 이름 기반 대체 키로 떨어지고, 화면은 계속 뜬다.
 */

import type { DirectoryEmploymentType } from './person-employment';

export interface DirectoryPerson {
  personId: string;
  name: string;
  nickname: string;
  /**
   * 조회 시점의 근로형태. 동일인 판정에는 쓰지 않고, 후보 목록을 거를 때만 본다.
   * 인력 명부를 아직 못 읽었을 때를 위해 선택 항목으로 둔다.
   */
  employmentType?: DirectoryEmploymentType;
}

export interface PersonDirectory {
  /** 이름·별명·"이름(별명)" 중 무엇으로 물어도 같은 personId 를 돌려준다. */
  resolveId(value: string): string | null;
  /** 이름으로 별명을 채운다. 표시용. */
  resolveNickname(value: string): string;
  readonly size: number;
}

export function compactIdentity(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()\s]/g, '')
    .trim();
}

/** "홍길동(길동)" 을 이름과 별명으로 나눈다. */
export function parseDisplayName(value: unknown): { full: string; name: string; nickname: string } {
  const text = String(value || '').trim();
  const match = text.match(/^(.+?)\s*\((.+?)\)\s*$/);
  return {
    full: text,
    name: match?.[1]?.trim() || text,
    nickname: match?.[2]?.trim() || '',
  };
}

function identityKeys(name: string, nickname: string): string[] {
  return [
    name,
    nickname,
    nickname ? `${name}(${nickname})` : '',
    nickname ? `${name} ${nickname}` : '',
  ];
}

const EMPTY: PersonDirectory = {
  resolveId: () => null,
  resolveNickname: () => '',
  size: 0,
};

export const EMPTY_PERSON_DIRECTORY = EMPTY;

export function buildPersonDirectory(people: DirectoryPerson[] | null | undefined): PersonDirectory {
  const list = Array.isArray(people) ? people : [];
  if (list.length === 0) return EMPTY;

  const ids = new Map<string, string>();
  const nicknames = new Map<string, string>();

  list.forEach((person) => {
    const name = String(person?.name || '').trim();
    const nickname = String(person?.nickname || '').trim();
    const personId = String(person?.personId || '').trim();
    if (!name || !personId) return;
    identityKeys(name, nickname).forEach((value) => {
      const key = compactIdentity(value);
      // 먼저 등록된 쪽을 이긴다. 동명이인이 있으면 뒤엣사람이 앞사람을 덮어쓰지 않게.
      if (key && !ids.has(key)) ids.set(key, personId);
      if (key && nickname && !nicknames.has(key)) nicknames.set(key, nickname);
    });
  });

  return {
    resolveId(value: string) {
      const parsed = parseDisplayName(value);
      for (const candidate of identityKeys(parsed.name, parsed.nickname)) {
        const key = compactIdentity(candidate);
        if (key && ids.has(key)) return ids.get(key) as string;
      }
      const whole = compactIdentity(parsed.full);
      return (whole && ids.get(whole)) || null;
    },
    resolveNickname(value: string) {
      const parsed = parseDisplayName(value);
      if (parsed.nickname) return parsed.nickname;
      return nicknames.get(compactIdentity(parsed.name)) || '';
    },
    size: ids.size,
  };
}
