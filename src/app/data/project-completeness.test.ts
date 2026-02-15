import { describe, expect, it } from 'vitest';
import { computeProjectCompleteness } from './project-completeness';

describe('project completeness', () => {
  it('returns 0% for empty project-like objects', () => {
    const r = computeProjectCompleteness({});
    expect(r.percent).toBe(0);
    expect(r.filled).toBe(0);
    expect(r.total).toBeGreaterThan(0);
    expect(r.missing.length).toBe(r.total);
  });

  it('counts filled fields and computes percent', () => {
    const r = computeProjectCompleteness({
      department: 'L-개발협력센터',
      clientOrg: 'KOICA',
      managerName: '베리',
      managerId: 'u1',
      accountType: 'DEDICATED',
      contractStart: '2026-01-01',
      contractEnd: '2026-12-31',
      contractAmount: 100,
      paymentPlanDesc: '선금80%, 잔금20%',
      groupwareName: 'IBS',
    } as any);

    expect(r.filled).toBe(r.total);
    expect(r.percent).toBe(100);
    expect(r.missing.length).toBe(0);
  });
});

