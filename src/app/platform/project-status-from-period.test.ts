import { describe, expect, it } from 'vitest';
import { deriveProjectStatusFromContractPeriod } from './project-status-from-period';

const base = { contractStart: '2026-03-01', contractEnd: '2026-12-31', currentStatus: 'IN_PROGRESS' as const };

describe('deriveProjectStatusFromContractPeriod', () => {
  it('reads the status off the contract period', () => {
    expect(deriveProjectStatusFromContractPeriod({ ...base, today: '2026-02-28' })).toBe('CONTRACT_PENDING');
    expect(deriveProjectStatusFromContractPeriod({ ...base, today: '2026-03-01' })).toBe('IN_PROGRESS');
    expect(deriveProjectStatusFromContractPeriod({ ...base, today: '2026-12-31' })).toBe('IN_PROGRESS');
    expect(deriveProjectStatusFromContractPeriod({ ...base, today: '2027-01-01' })).toBe('COMPLETED');
  });

  it('never overwrites 완료(잔금 대기) — 날짜가 아니라 입금 여부의 문제다', () => {
    expect(deriveProjectStatusFromContractPeriod({
      ...base,
      currentStatus: 'COMPLETED_PENDING_PAYMENT',
      today: '2027-06-01',
    })).toBe('COMPLETED_PENDING_PAYMENT');
  });

  it('leaves the stored status alone until both dates are real', () => {
    expect(deriveProjectStatusFromContractPeriod({ ...base, contractStart: '', today: '2026-06-01' })).toBe('IN_PROGRESS');
    expect(deriveProjectStatusFromContractPeriod({ ...base, contractEnd: '2026', today: '2026-06-01' })).toBe('IN_PROGRESS');
    // 종료일이 시작일보다 앞서면 기간이 아니다. 판정하지 않는다.
    expect(deriveProjectStatusFromContractPeriod({
      ...base, contractStart: '2026-12-31', contractEnd: '2026-03-01',
      currentStatus: 'CONTRACT_PENDING', today: '2026-06-01',
    })).toBe('CONTRACT_PENDING');
  });
});
