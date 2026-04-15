import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dashboardPageSource = readFileSync(
  resolve(import.meta.dirname, 'DashboardPage.tsx'),
  'utf8',
);

describe('DashboardPage shell contract', () => {
  it('keeps the admin landing page focused on operational surfaces only', () => {
    expect(dashboardPageSource).toContain('캐시플로 추출');
    expect(dashboardPageSource).toContain('전체 프로젝트');
    expect(dashboardPageSource).not.toContain("import { WelcomeBanner } from './WelcomeBanner';");
    expect(dashboardPageSource).not.toContain('UpdateReminderBadge');
    expect(dashboardPageSource).not.toContain('ValidationSummaryCard');
    expect(dashboardPageSource).not.toContain('ProjectValidationBadge');
    expect(dashboardPageSource).not.toContain("text-[10px]\">검증</TableHead>");
  });
});
