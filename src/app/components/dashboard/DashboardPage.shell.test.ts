import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardPageSource = readFileSync(
  resolve(import.meta.dirname, 'DashboardPage.tsx'),
  'utf8',
);

describe('DashboardPage shell contract', () => {
  it('keeps the admin landing page anomaly-first with monitoring queue and tool CTAs', () => {
    expect(dashboardPageSource).toContain('AdminMonitoringQueue');
    expect(dashboardPageSource).toContain('SystemHealthPanel');
    expect(dashboardPageSource).toContain('ActivityFeed');
    expect(dashboardPageSource).toContain('캐시플로 관제');
    expect(dashboardPageSource).toContain('인건비 관제');
    expect(dashboardPageSource).toContain('캐시플로 모니터링');
    expect(dashboardPageSource).toContain('payrollReviewPendingCount');
    expect(dashboardPageSource).toContain('payrollMissingCandidateCount');
    expect(dashboardPageSource).toContain('payrollFinalUnconfirmedCount');
    expect(dashboardPageSource).toContain('resolvePayrollReviewQueue');
    expect(dashboardPageSource).toContain('증빙 큐');
    expect(dashboardPageSource).toContain('승인 큐');
    expect(dashboardPageSource).not.toContain('캐시플로 추출');
    expect(dashboardPageSource).not.toContain('전체 사업');
    expect(dashboardPageSource).not.toContain('최근 거래');
    expect(dashboardPageSource).not.toContain('캐시플로 이상치');
    expect(dashboardPageSource).not.toContain('인사 공지 (홈)');
    expect(dashboardPageSource).not.toContain('MetricCard');
    expect(dashboardPageSource).not.toContain('AlertStrip');
    expect(dashboardPageSource).not.toContain('item.yearMonth === yearMonth');
    expect(dashboardPageSource).not.toContain('deptBreakdown');
    expect(dashboardPageSource).not.toContain('typeBreakdown');
    expect(dashboardPageSource).not.toContain('cashflowTrend');
  });
});
