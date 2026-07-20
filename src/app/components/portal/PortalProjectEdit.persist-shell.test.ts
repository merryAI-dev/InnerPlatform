import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalProjectEdit.tsx'), 'utf8');

describe('PortalProjectEdit persistence shell', () => {
  it('stores portal edits as approval-gated change requests instead of mutating the project snapshot', () => {
    expect(source).toContain('createProjectInfoDraftClient');
    expect(source).toContain('draftClient.submit(ownership');
    expect(source).not.toContain('patchProjectSnapshot');
    expect(source).not.toContain('upsertProjectViaBff');
    expect(source).not.toContain('setDoc(');
  });

  it('uses the executive review resubmit endpoint only for explicit resubmission', () => {
    expect(source).toContain("resubmit: actionId === 'resubmit'");
    expect(source).toContain("actionId === 'resubmit' && resubmitComment.trim()");
    expect(source).not.toContain('resubmitProjectExecutiveReviewViaBff');
  });

  it('reads canonical and legacy project request collections so reviewer feedback is retained', () => {
    expect(source).toContain("['project_requests', 'projectRequests']");
    expect(source).toContain('const sourceRows = new Map<string, ProjectRequest>()');
  });

  it('keeps the project edit draft key stable across request listener updates', () => {
    expect(source).toContain('const autosaveKey = `portal-edit-${orgId}-${project.id}-${actor.uid}`');
    expect(source).toContain('draftKey={autosaveKey}');
    expect(source).not.toContain('requestDoc?.updatedAt');
  });

  it('shows a centered confirmation dialog instead of a corner toast after saving', () => {
    expect(source).toContain('saveSuccessDialogOpen');
    expect(source).toContain('<AlertDialog open={saveSuccessDialogOpen}');
    expect(source).toContain('프로젝트 수정 요청이 등록되었습니다');
    expect(source).not.toContain("toast.success('프로젝트 변경 요청을 저장했습니다.");
    expect(source).not.toContain("toast.success('프로젝트 변경 요청을 다시 제출했습니다.");
  });

  it('keeps a management planning rejection distinct from the CIC review and enables resubmission', () => {
    expect(source).toContain('getManagementPlanningReview(project)');
    expect(source).toContain('hasManagementPlanningReview(project)');
    expect(source).toContain("managementPlanningReview.status === 'REVISION_REJECTED'");
    expect(source).toContain('data-testid="portal-management-planning-review"');
    expect(source).toContain('buildPortalProjectReviewFeedback(project, requestDoc)');
  });
});
