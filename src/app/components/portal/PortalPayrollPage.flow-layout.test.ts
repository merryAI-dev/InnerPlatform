import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalPayrollSource = readFileSync(
  resolve(import.meta.dirname, 'PortalPayrollPage.tsx'),
  'utf8',
);

describe('PortalPayrollPage payroll review flow', () => {
  it('turns the payroll page into a 실무자 memo-review console before admin final confirm', () => {
    expect(portalPayrollSource).toContain('인건비 적요 검토');
    expect(portalPayrollSource).toContain('실무자 1차 검토');
    expect(portalPayrollSource).toContain('실무자 입력 금액');
    expect(portalPayrollSource).toContain('캐시플로 Projection');
    expect(portalPayrollSource).toContain('금액 불일치');
    expect(portalPayrollSource).toContain('맞음');
    expect(portalPayrollSource).toContain('아님');
    expect(portalPayrollSource).toContain('보류');
    expect(portalPayrollSource).toContain('관리자 최종 확정 대기');
    expect(portalPayrollSource).toContain("transactionsFetchState === 'ready'");
    expect(portalPayrollSource).not.toContain('acknowledgeMonthlyClose');
    expect(portalPayrollSource).not.toContain('needsMonthlyCloseAck');
  });
});
