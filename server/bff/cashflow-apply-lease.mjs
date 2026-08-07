import { readOptionalText } from './bff-utils.mjs';

// 시트 반영 락(cashflow_sheet_publications.status=APPLYING)은 반영을 시작한 요청이
// 직접 해제한다. 그 요청이 중단되면 해제 코드가 실행되지 못해 프로젝트가 영구히 잠긴다.
// applyStartedAt 기준 임대 만료를 두어 고착을 시간으로 끊는다.
// 기본값 10분은 BFF 함수의 최대 수명(vercel.json maxDuration 300초)보다 길다. 즉 만료
// 시점에는 락을 잡은 함수가 이미 강제 종료된 뒤이므로 해제해도 동시 실행이 아니다.
// CASHFLOW_APPLY_LEASE_MS=0 은 임대를 끄고 기존 동작을 되살린다.
export const DEFAULT_CASHFLOW_APPLY_LEASE_MS = 10 * 60 * 1000;

export function cashflowApplyLeaseMs(env = process.env) {
  const raw = readOptionalText(env?.CASHFLOW_APPLY_LEASE_MS);
  if (!raw) return DEFAULT_CASHFLOW_APPLY_LEASE_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CASHFLOW_APPLY_LEASE_MS;
  return Math.floor(parsed);
}

function parseTimestampMs(value) {
  const text = readOptionalText(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readCashflowApplyLeaseState(publication, { nowMs, leaseMs } = {}) {
  const status = readOptionalText(publication?.status).toUpperCase();
  const applying = status === 'APPLYING';
  const startedAtMs = parseTimestampMs(publication?.applyStartedAt);
  const effectiveLeaseMs = Number.isFinite(leaseMs) && leaseMs >= 0
    ? leaseMs
    : DEFAULT_CASHFLOW_APPLY_LEASE_MS;
  const leaseEnabled = effectiveLeaseMs > 0;
  // applyStartedAt 은 APPLYING 전이와 같은 트랜잭션에서 기록된다. 값이 없으면 이 경로가
  // 쓰지 않은 문서이므로 시간으로 판단하지 않고 관리자 해제에 맡긴다.
  const expired = applying
    && leaseEnabled
    && startedAtMs !== null
    && Number.isFinite(nowMs)
    && nowMs - startedAtMs >= effectiveLeaseMs;
  return {
    status,
    applying,
    stagedRunId: readOptionalText(publication?.stagedRunId),
    applyStartedAt: readOptionalText(publication?.applyStartedAt),
    expiresAt: applying && leaseEnabled && startedAtMs !== null
      ? new Date(startedAtMs + effectiveLeaseMs).toISOString()
      : '',
    missingStartedAt: applying && startedAtMs === null,
    expired,
    blocked: applying && !expired,
  };
}
