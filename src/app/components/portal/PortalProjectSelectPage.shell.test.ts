import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectSelectPage.tsx'), 'utf8');

describe('PortalProjectSelectPage shell', () => {
  it('keeps the page focused on current-session project choice only', () => {
    expect(source).toContain('오늘 작업할 프로젝트 선택');
    expect(source).toContain('이 프로젝트로 시작');
    expect(source).toContain('data-testid="portal-project-select-page"');
    expect(source).toContain('id="portal-project-search"');
    expect(source).toContain('name="portalProjectSearch"');
    expect(source).toContain("resolvePortalProjectSwitchPath('/portal/budget')");
    expect(source).toContain('blockedPortalAccess');
    expect(source).not.toContain('resolveRequestedRedirectPath');
    expect(source).not.toContain("navigate('/portal/onboarding'");
    expect(source).not.toContain("navigate('/', { replace: true })");
    expect(source).not.toContain('주사업으로 지정');
    expect(source).not.toContain('증빙 드라이브 연결');
    expect(source).toContain('CashflowCanonicalSummary');
    expect(source).toContain('누적 Projection-Actual 정산');
    expect(source).toContain('canonicalSummaries.retry(project.id)');
  });

  it('searches the full PPT-defined project identity fields', () => {
    expect(source).toContain('matchesProjectSearch(project, normalizedQuery)');
    expect(source).toContain('프로젝트명, 계약명, 계약대상, 담당조직, 운영진으로 검색');
  });
});
