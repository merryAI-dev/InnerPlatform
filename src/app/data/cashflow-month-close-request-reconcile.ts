import type { CashflowMonthCloseRequest } from '../lib/platform-bff-client';

// 브라우저는 요청 POST 를 27초에 끊지만 서버(Vercel, 300초)는 계속 돌아 저장까지 간다.
// 타임아웃은 실패가 아니라 모름이므로 canonical month-close 상태를 몇 번 다시 읽는다.

export function isRequestTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

export function isRequestFromThisAttempt(
  request: CashflowMonthCloseRequest | null,
  input: { actorUid: string; startedAtIso: string },
): boolean {
  if (!request) return false;
  if (request.requestedByUid !== input.actorUid) return false;
  if (!request.requestedAt || request.requestedAt < input.startedAtIso) return false;
  return request.status === 'PENDING_APPROVAL' || request.status === 'BUILDING';
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
      current = null;
    }
    if (isRequestFromThisAttempt(current, input)) {
      if (current?.status === 'PENDING_APPROVAL') return current;
    }
    if (attempt < attempts - 1) await sleep(waitMs);
  }
  return null;
}
