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
    expect(source).not.toContain('data-testid="projects-tab-trash"');
    expect(source).not.toContain('data-testid="projects-tab-confirmed"');
  });

  it('visually groups lifecycle tabs as a connected navy three-stage control', () => {
    expect(source).toContain('grid-cols-3');
    expect(source).toContain('bg-[#0f2747]');
    expect(source).toContain('data-[state=active]:bg-[#174a7c]');
    expect(source).toContain('data-[state=active]:text-white');
    expect(source).toContain('rounded-t-none');
  });

  it('keeps filter defaults while showing planner-defined labels in the required order', () => {
    expect(source).toContain('프로젝트 진행 현황');
    expect(source).toContain('conic-gradient');
    expect(source).toContain('전체 조직');
    expect(source).toContain('전체 상태');
    expect(source).toContain('전체 정산 유형');
    expect(source.indexOf('담당조직</Label>')).toBeLessThan(source.indexOf('진행 상태</Label>'));
    expect(source.indexOf('진행 상태</Label>')).toBeLessThan(source.indexOf('정산 유형</Label>'));
  });

  it('keeps the contract-pending action consistent across rows', () => {
    expect(source).toContain('navigate(`/projects/${p.id}/edit?phase=CONFIRMED`)');
    expect(source).toContain('확정 <ArrowRight className="w-3 h-3" />');
    expect(source).not.toContain("p.phase === 'PROSPECT'");
  });

  it('expands project context inline instead of navigating away from the list', () => {
    expect(source).toContain('expandedProjectId');
    expect(source).toContain('프로젝트 목적');
    expect(source).toContain('주요 내용');
    expect(source).toContain('normalizeProjectDepartment(p.department)');
    expect(source).not.toContain('onClick={() => navigate(`/projects/${p.id}`)}');
  });

  it('surfaces pending PM change requests from both request collections', () => {
    expect(source).toContain('usePendingProjectChangeRequests');
    expect(source).toContain('수정 검토 중');
    expect(pendingHookSource).toContain("const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests']");
    expect(pendingHookSource).toContain("request.requestKind !== 'CHANGE'");
    expect(pendingHookSource).toContain("request.targetProjectId || request.approvedProjectId");
  });
});
