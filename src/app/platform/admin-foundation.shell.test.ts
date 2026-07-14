import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const navConfigSource = readFileSync(
  resolve(import.meta.dirname, 'nav-config.ts'),
  'utf8',
);

const routesSource = readFileSync(
  resolve(import.meta.dirname, '../routes.tsx'),
  'utf8',
);

describe('admin monitoring foundation shell contract', () => {
  it('renames the cashflow nav entry to monitoring language and exposes users nav', () => {
    expect(navConfigSource).not.toContain("label: '기능 검색'");
    expect(navConfigSource).toContain("to: '/dashboard'");
    expect(navConfigSource).toContain("label: '캐시플로 모니터링'");
    expect(navConfigSource).toContain("label: '프로젝트 등록/승인'");
    expect(navConfigSource).toContain("to: '/users'");
    expect(navConfigSource).toContain("label: '권한 관리'");
    expect(navConfigSource).not.toContain("to: '/settings?tab=org'");
    expect(navConfigSource).not.toContain("label: '조직 정보'");
    expect(navConfigSource).toContain("to: '/settings?tab=members'");
    expect(navConfigSource).toContain("label: '멤버DB'");
    expect(navConfigSource).toContain("to: '/settings?tab=tenants'");
    expect(navConfigSource).toContain("label: '조직DB'");
    expect(navConfigSource).not.toContain("label: '캐시플로 추출'");
    expect(navConfigSource).not.toContain("label: '사업이관'");
  });

  it('registers a dedicated cashflow export route under the admin shell', () => {
    expect(routesSource).toContain("const FeatureSearchPage");
    expect(routesSource).toContain("function MobileAwareAdminHome()");
    expect(routesSource).toContain(": <S C={FeatureSearchPage} />;");
    expect(routesSource).toContain("{ index: true, element: <MobileAwareAdminHome /> }");
    expect(routesSource).toContain("{ path: 'dashboard', element: <S C={DashboardPage} /> }");
    expect(routesSource).toContain("{ path: 'cashflow/export', element: <S C={CashflowExportPage} /> }");
    expect(routesSource).toContain("{ path: 'cashflow/weekly', element: <S C={CashflowWeeklyPage} /> }");
    expect(routesSource).toContain("{ path: 'cashflow/analytics', element: <S C={CashflowAnalyticsPage} /> }");
  });
});
