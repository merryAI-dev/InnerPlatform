import type { ProjectStatus } from '../data/types';

/**
 * 계약 기간으로 프로젝트 진행 상태를 정한다.
 *
 * 진행 상태는 사람이 고를 것이 아니라 날짜에서 따라 나오는 값이다. 손으로 고르게 두면
 * 계약이 끝난 사업이 몇 달째 "진행 중"으로 남는다.
 *
 * 다만 **완료(잔금 대기)는 날짜로 알 수 없다.** 기간이 끝났는지가 아니라 돈이 들어왔는지의
 * 문제라, 이미 그 상태인 사업은 그대로 둔다. 날짜가 아직 안 채워진 경우도 건드리지 않는다.
 */
export function deriveProjectStatusFromContractPeriod(input: {
  contractStart: string;
  contractEnd: string;
  currentStatus: ProjectStatus;
  today: string;
}): ProjectStatus {
  if (input.currentStatus === 'COMPLETED_PENDING_PAYMENT') return input.currentStatus;

  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  const start = String(input.contractStart || '').slice(0, 10);
  const end = String(input.contractEnd || '').slice(0, 10);
  const today = String(input.today || '').slice(0, 10);
  if (!isDate(start) || !isDate(end) || !isDate(today)) return input.currentStatus;
  if (start > end) return input.currentStatus;

  if (today < start) return 'CONTRACT_PENDING';
  if (today > end) return 'COMPLETED';
  return 'IN_PROGRESS';
}
