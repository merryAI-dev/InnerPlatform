import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'ProjectMigrationAuditPage.tsx'), 'utf8');
const controlBarSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditControlBar.tsx'), 'utf8');
const documentSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditDocumentDialog.tsx'), 'utf8');
const recordListSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditRecordList.tsx'), 'utf8');
const previewSource = readFileSync(resolve(import.meta.dirname, 'ContractDocumentPreview.tsx'), 'utf8');
const compositeSource = [pageSource, controlBarSource, documentSource, recordListSource, previewSource].join('\n');

describe('ProjectMigrationAuditPage review flow', () => {
  it('keeps a filter-first inbox and opens a formal three-line approval document', () => {
    expect(compositeSource).toContain('data-testid="migration-review-search-bar"');
    expect(compositeSource).toContain('data-testid="migration-review-record-list"');
    expect(compositeSource).toContain('data-testid="migration-review-document"');
    expect(compositeSource).toContain('프로젝트 등록 및 승인서');
    expect(compositeSource).toContain('기안');
    expect(compositeSource).toContain('조직장 승인');
    expect(compositeSource).toContain('경영기획실 합의');
    expect(compositeSource).toContain('실무자 제출/재제출 메모');
    expect(compositeSource).toContain("entry.status === 'PENDING' ? '실무자 제출/재제출 메모'");
    expect(compositeSource).toContain('ApprovalSeal');
    expect(compositeSource).toContain('CIC 필터');
    expect(compositeSource).toContain('상태 필터');
    expect(compositeSource).toContain('프로젝트 검색');
    expect(compositeSource).toContain('문서 열기');
  });

  it('keeps the designated organization-head guard in the UI as defense in depth', () => {
    expect(pageSource).toContain('const designatedApproverId');
    expect(pageSource).toContain('designatedApproverId === authUser.uid');
    expect(pageSource).toContain('if (!canFinalize)');
    expect(pageSource).not.toContain('isSameMigrationAuditCic');
    expect(documentSource).toContain('canFinalize: boolean');
    expect(documentSource).toContain('지정된 조직장만 승인 또는 반려할 수 있습니다.');
  });

  it('uses a separate management-planning command only after organization approval', () => {
    expect(pageSource).toContain("reviewStage = 'executive'");
    expect(pageSource).toContain("reviewStage === 'managementPlanning'");
    expect(pageSource).toContain("record.project.executiveReviewStatus === 'APPROVED'");
    expect(pageSource).toContain('reviewProjectManagementPlanningStatusViaBff');
    expect(pageSource).toContain("reviewStatus: actionMode === 'approve' ? 'AGREED' : 'REVISION_REJECTED'");
    expect(pageSource).toContain('프로젝트 코드를 입력해 주세요.');
    expect(pageSource).not.toContain("reviewStatus: 'PLANNING_AGREED'");
    expect(recordListSource).toContain('프로젝트 코드');
  });

  it('keeps the contract in the document popup and fetches private originals through the BFF', () => {
    expect(pageSource).toContain('resolveMigrationReviewContractDocument');
    expect(pageSource).toContain('downloadProjectRequestAttachmentViaBff');
    expect(pageSource).toContain('URL.createObjectURL');
    expect(pageSource).toContain('URL.revokeObjectURL');
    expect(documentSource).toContain('ContractDocumentPreview');
    expect(previewSource).toContain('data-testid="contract-document-preview"');
    expect(previewSource).toContain('<iframe');
  });
});
