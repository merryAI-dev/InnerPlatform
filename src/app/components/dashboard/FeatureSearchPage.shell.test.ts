import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'FeatureSearchPage.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');

describe('FeatureSearchPage shell contract', () => {
  it('makes feature search the full-screen admin landing page with admin and PM grouping', () => {
    expect(routesSource).toContain('const FeatureSearchPage');
    expect(routesSource).toContain('{ index: true, element: <S C={FeatureSearchPage} /> }');
    expect(routesSource).toContain("{ path: 'dashboard', element: <S C={DashboardPage} /> }");
    expect(source).toContain('AdminCommandSearch');
    expect(source).toContain('displayName');
    expect(source).toContain('안녕하세요, {displayName} 사내기업가님');
    expect(source).toContain('아래 검색창에서 원하시는 기능을 바로 탐색하실 수 있습니다.');
    expect(source).toContain('관리자');
    expect(source).toContain('PM');
    expect(source).toContain('min-h-dvh');
    expect(source).toContain('border-sky-200');
    expect(source).toContain('border-emerald-200');
    expect(source).toContain('backdrop-blur-xl');
    expect(source).toContain('bg-white/50');
  });
});
