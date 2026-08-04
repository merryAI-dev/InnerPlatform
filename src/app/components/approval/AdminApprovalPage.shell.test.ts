import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AdminApprovalPage.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');

describe('AdminApprovalPage shell contract', () => {
  it('keeps the project registration queue as the only approval surface on this page', () => {
    expect(routesSource).toContain("{ path: 'projects/migration-audit', element: <S C={AdminApprovalPage} /> }");
    expect(routesSource).not.toContain("{ path: 'projects/migration-audit', element: <S C={ProjectMigrationAuditPage} /> }");
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('<ProjectMigrationAuditPage embedded reviewScope="pending" />');
    expect(source).toContain('pendingProjectReviews');
    expect(source).toContain('project.executiveReviewStatus');
    expect(source).toContain('프로젝트 등록 검토');
    expect(source).toContain('대표 검토');
    expect(source).toContain('프로젝트 등록 요청부터 먼저 정리합니다');
    expect(source).not.toContain('ProjectRequestApprovalSection');
    expect(source).not.toContain('EXPENSE_SETS');
    expect(source).not.toContain('CHANGE_REQUESTS');
    expect(source).not.toContain('사업비 승인 대기');
    expect(source).not.toContain('인력변경 승인 대기');
    expect(source).not.toContain('actionDialog');
  });

  it('no longer duplicates month-close approval, which now lives in the cashflow settlement flow', () => {
    expect(source).not.toContain('MonthlySettlementApprovalSection');
    expect(source).not.toContain('pendingMonthlySettlements');
    expect(source).not.toContain('월 결산');
    expect(source).toContain('const totalPending = pendingProjectReviews.length;');
  });
});
