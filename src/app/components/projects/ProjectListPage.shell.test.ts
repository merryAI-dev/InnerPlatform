import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectListPage.tsx'), 'utf8');
const pendingHookSource = readFileSync(resolve(import.meta.dirname, 'usePendingProjectChangeRequests.ts'), 'utf8');

describe('ProjectListPage shell contract', () => {
  it('does not show the retired monitoring preset filter bar', () => {
    expect(source).not.toContain('data-testid="project-monitoring-presets"');
    expect(source).not.toContain('data-testid="project-monitoring-preset-no-ledger"');
    expect(source).not.toContain('data-testid="project-monitoring-preset-pending-approval"');
    expect(source).not.toContain('data-testid="project-monitoring-preset-missing-evidence"');
    expect(source).not.toContain('모니터링 프리셋');
  });

  it('shows settlement type labels instead of O/X settlement flags', () => {
    expect(source).toContain('정산 유형');
    expect(source).toContain('전체 정산 유형');
    expect(source).toContain('settlementFilter');
    expect(source).not.toContain('typeFilter');
    expect(source).toContain('normalizeSettlementType(p.settlementType)');
    expect(source).toContain('SETTLEMENT_TYPE_LABELS[normalizeSettlementType(p.settlementType)]');
    expect(source).not.toContain('SETTLEMENT_TYPE_SHORT[normalizeSettlementType(p.settlementType)]');
    expect(source).not.toContain('p.isSettled ?');
  });

  it('searches the PPT-defined project fields and exposes primary actions', () => {
    expect(source).toContain('matchesProjectListFilters(project, {');
    expect(source).toContain('프로젝트명, 계약명, 계약대상, 담당조직, 운영진 검색');
    expect(source).toContain("navigate('/projects/new')");
    expect(source).toContain("navigate('/approvals')");
    expect(source).toContain('프로젝트 등록');
    expect(source).toContain('승인 대기');
    expect(source).toContain("canAccessAdminPath(currentUser?.role, '/projects/new')");
    expect(source).toContain("canAccessAdminPath(currentUser?.role, '/approvals')");
  });

  it('shows the business owner from registeredBy fields', () => {
    expect(source).toContain('사업 담당자');
    expect(source).toContain('p.registeredByName || p.managerName');
  });

  it('orders lifecycle tabs as contract-pending, in-progress, completed, then trash', () => {
    expect(source).toContain('data-testid="projects-tab-contract-pending"');
    expect(source).toContain('data-testid="projects-tab-in-progress"');
    expect(source).toContain('data-testid="projects-tab-completed"');
    expect(source.indexOf('data-testid="projects-tab-contract-pending"')).toBeLessThan(
      source.indexOf('data-testid="projects-tab-in-progress"'),
    );
    expect(source.indexOf('data-testid="projects-tab-in-progress"')).toBeLessThan(
      source.indexOf('data-testid="projects-tab-completed"'),
    );
    expect(source.indexOf('data-testid="projects-tab-completed"')).toBeLessThan(
      source.indexOf('data-testid="projects-tab-trash"'),
    );
    expect(source).not.toContain('data-testid="projects-tab-confirmed"');
  });

  it('surfaces pending PM change requests from both request collections', () => {
    expect(source).toContain('usePendingProjectChangeRequests');
    expect(source).toContain('수정 검토 중');
    expect(pendingHookSource).toContain("const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests']");
    expect(pendingHookSource).toContain("request.requestKind !== 'CHANGE'");
    expect(pendingHookSource).toContain("request.targetProjectId || request.approvedProjectId");
  });
});
