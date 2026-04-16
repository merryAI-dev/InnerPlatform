import { describe, expect, it } from 'vitest';
import { getPayrollPaidStatusLabel } from './payroll-display';

describe('payroll-display', () => {
  it('maps raw payroll run enums to human-readable labels for PM and admin surfaces', () => {
    expect(getPayrollPaidStatusLabel('UNKNOWN')).toBe('미확인');
    expect(getPayrollPaidStatusLabel('AUTO_MATCHED')).toBe('자동매칭');
    expect(getPayrollPaidStatusLabel('CONFIRMED')).toBe('확정');
    expect(getPayrollPaidStatusLabel('MISSING')).toBe('후보 없음');
  });
});
