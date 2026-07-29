import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AdminApprovalPage.tsx'), 'utf8');
const monthlySource = readFileSync(resolve(import.meta.dirname, 'MonthlySettlementApprovalSection.tsx'), 'utf8');

describe('AdminApprovalPage shell contract', () => {
  it('leads with project registration review as a decision-ready approval surface', () => {
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('<ProjectMigrationAuditPage embedded reviewScope="pending" />');
    expect(source).toContain('pendingProjectReviews');
    expect(source).toContain('project.executiveReviewStatus');
    expect(source).toContain('프로젝트 등록 검토');
    expect(source).toContain('대표 검토');
    expect(source).toContain('프로젝트 등록 요청부터 먼저 정리합니다');
    expect(source).not.toContain('ProjectRequestApprovalSection');
  });

  it('includes designated-head monthly settlement approval with BFF persistence', () => {
    expect(source).toContain('MonthlySettlementApprovalSection');
    expect(source).toContain('월 결산');
    expect(monthlySource).toContain('fetchPendingCashflowMonthCloseRequestsViaBff');
    expect(monthlySource).toContain('reviewCashflowMonthCloseRequestViaBff');
    expect(monthlySource).toContain("decision: action.decision");
    expect(monthlySource).toContain('반려 사유 (필수)');
    expect(monthlySource).toContain('월 결산 승인 대기 항목이 없습니다');
  });
});
