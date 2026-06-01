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
    expect(source).toContain('normalizeSettlementType(p.settlementType)');
    expect(source).toContain('SETTLEMENT_TYPE_SHORT[normalizeSettlementType(p.settlementType)]');
    expect(source).not.toContain('p.isSettled ?');
  });

  it('shows the business owner from registeredBy fields', () => {
    expect(source).toContain('사업 담당자');
    expect(source).toContain('p.registeredByName || p.managerName');
  });

  it('surfaces pending PM change requests from both request collections', () => {
    expect(source).toContain('usePendingProjectChangeRequests');
    expect(source).toContain('수정 검토 중');
    expect(pendingHookSource).toContain("const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests']");
    expect(pendingHookSource).toContain("request.requestKind !== 'CHANGE'");
    expect(pendingHookSource).toContain("request.targetProjectId || request.approvedProjectId");
  });
});
