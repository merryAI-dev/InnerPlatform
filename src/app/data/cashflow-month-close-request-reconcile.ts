import type { CashflowMonthCloseRequest } from '../lib/platform-bff-client';

// 브라우저는 요청 POST 를 27초에 끊지만 서버(Vercel, 300초)는 계속 돌아 저장까지 간다.
// 첫 누적 요청은 2023-01 부터 43개월 shard 를 한 트랜잭션에 쓰므로 그 창이 실제로 열린다.
// 그래서 타임아웃은 "실패" 가 아니라 "모름" 이다. 서버의 현재 요청을 몇 번 다시 읽어서
// 이번 시도가 남긴 요청이 보이면 성공, 끝까지 안 보이면 그때 실패라고 말한다. 둘 중 하나만.

export function isRequestTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

// 이번 시도가 만든 요청인가: 같은 사람이, 시도 시작 이후에, 아직 살아 있는 상태로.
export function isRequestFromThisAttempt(
  request: CashflowMonthCloseRequest | null,
  input: { actorUid: string; startedAtIso: string },
): boolean {
  if (!request) return false;
  if (request.requestedByUid !== input.actorUid) return false;
  if (!request.requestedAt || request.requestedAt < input.startedAtIso) return false;
  return request.status === 'PENDING' || request.status === 'BUILDING';
}

export async function reconcileMonthCloseRequestAfterTimeout(input: {
  fetchCurrent: () => Promise<CashflowMonthCloseRequest | null>;
  actorUid: string;
  startedAtIso: string;
  attempts?: number;
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<CashflowMonthCloseRequest | null> {
  const attempts = input.attempts ?? 10;
  const waitMs = input.waitMs ?? 3_000;
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let current: CashflowMonthCloseRequest | null = null;
    try {
      current = await input.fetchCurrent();
    } catch {
      current = null; // 조회 실패는 "아직 모름" 이지 "없음" 이 아니다. 다음 회차에 다시 본다.
    }
    if (isRequestFromThisAttempt(current, input)) {
      if (current?.status === 'PENDING') return current;
      // BUILDING 은 서버가 아직 쓰는 중. 기다린다.
    }
    if (attempt < attempts - 1) await sleep(waitMs);
  }
  return null;
}
