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
    expect(navConfigSource).toContain("label: '캐시플로 모니터링'");
    expect(navConfigSource).toContain("to: '/users'");
    expect(navConfigSource).toContain("label: '권한/사용자'");
    expect(navConfigSource).not.toContain("label: '캐시플로 추출'");
  });

  it('registers a dedicated cashflow export route under the admin shell', () => {
    expect(routesSource).toContain("{ path: 'cashflow/export', element: <S C={CashflowExportPage} /> }");
    expect(routesSource).toContain("{ path: 'cashflow/weekly', element: <S C={CashflowWeeklyPage} /> }");
    expect(routesSource).toContain("{ path: 'cashflow/analytics', element: <S C={CashflowAnalyticsPage} /> }");
  });
});
