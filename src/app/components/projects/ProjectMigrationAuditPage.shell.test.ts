import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'ProjectMigrationAuditPage.tsx'), 'utf8');
const controlBarSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditControlBar.tsx'), 'utf8');
const queueSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditQueueRail.tsx'), 'utf8');
const detailSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditDetailPanel.tsx'), 'utf8');
const previewSource = readFileSync(resolve(import.meta.dirname, 'ContractDocumentPreview.tsx'), 'utf8');
const compositeSource = [pageSource, controlBarSource, queueSource, detailSource, previewSource].join('\n');

describe('ProjectMigrationAuditPage shell contract', () => {
  it('presents the page as a PM registration executive approval console', () => {
    expect(pageSource).toContain('data-testid="migration-review-queue"');
    expect(pageSource).toContain('data-testid="migration-review-dossier"');
    expect(compositeSource).toContain('data-testid="migration-review-search-bar"');
    expect(compositeSource).toContain('data-testid="migration-review-decision-footer"');
    expect(compositeSource).toContain('CIC 필터');
    expect(compositeSource).toContain('상태 필터');
    expect(compositeSource).toContain('프로젝트 검색');
    expect(compositeSource).toContain('프로젝트명, 등록 원문, 계약 대상, PM 검색');
    expect(compositeSource).toContain('migration-review-project-search');
    expect(compositeSource).toContain('h-14');
    expect(compositeSource).toContain('border-2 border-slate-300');
    expect(compositeSource).toContain('승인');
    expect(compositeSource).toContain('수정 요청 후 반려');
    expect(compositeSource).toContain('중복·폐기');
    expect(compositeSource).toContain('PM 등록 프로젝트 검토');
    expect(compositeSource).toContain('PM이 포털에서 입력한 내용을 그대로');
    expect(compositeSource).toContain('CIC 대표 검토 대기열');
    expect(compositeSource).toContain('CIC 대표 검토 결정');
    expect(compositeSource).toContain('PM 재제출 시 변경 사항');
    expect(compositeSource).toContain('describeProjectRequestVersion');
    expect(compositeSource).toContain('수정 중');
    expect(compositeSource).toContain('PM 수정 요청');
    expect(compositeSource).not.toContain('사업명으로 검색');
    expect(compositeSource).not.toContain('우리 사업으로 승인');
    expect(compositeSource).not.toContain('연결 필요');
    expect(compositeSource).not.toContain('연결 완료');
    expect(compositeSource).not.toContain('기존 시스템에만 있는 프로젝트');
    expect(compositeSource).not.toContain('PM 등록 없음');
    expect(compositeSource).not.toContain('검토 후보');
    expect(compositeSource).not.toContain('비교할 다른 프로젝트 후보');
    expect(compositeSource).not.toContain('빠른 등록 시작');
    expect(compositeSource).not.toContain('기준 다시 적재');
    expect(compositeSource).not.toContain('운영 포커스');
  });

  it('does not describe approved records as read-only and removes review summary labels', () => {
    expect(compositeSource).not.toContain('기존 등록 프로젝트는 읽기 전용 참고 화면입니다. 별도 승인 액션은 보여주지 않습니다.');
    expect(compositeSource).not.toContain('읽기 전용');
    expect(detailSource).not.toContain('DetailFact label="검토자"');
    expect(detailSource).not.toContain('DetailFact label="검토일"');
    expect(detailSource).not.toContain('DetailFact label="검토 메모"');
    expect(detailSource).not.toContain("{isPmPortalProject ? 'PM 등록' : '기존 등록'}");
  });

  it('routes duplicate-discard decisions through the project trash flow', () => {
    expect(pageSource).toContain('trashProject');
    expect(pageSource).toContain("const shouldTrashProject = actionMode === 'discard'");
    expect(pageSource).toContain('await trashProject(activeRecord.project.id, trashReason)');
    expect(pageSource).toContain('trashedAt: now');
    expect(pageSource).toContain('trashedReason: trashReason');
  });

  it('listens to both canonical and legacy project request collections', () => {
    expect(pageSource).toContain("const PROJECT_REQUEST_COLLECTIONS: ProjectRequestCollectionName[] = ['project_requests', 'projectRequests']");
    expect(pageSource).toContain('__collectionName: collectionName');
    expect(compositeSource).toContain('isMigrationAuditPmRegistration');
  });

  it('shows the uploaded contract PDF next to analysis notes', () => {
    expect(detailSource).toContain('계약 분석 보조 정보');
    expect(detailSource).toContain('ContractDocumentPreview');
    expect(detailSource).toContain('계약서 PDF 원문');
    expect(detailSource).toContain('계약서 요약');
    expect(detailSource).not.toContain('AI/휴리스틱 요약');
    expect(previewSource).toContain('data-testid="contract-document-preview"');
    expect(previewSource).toContain('<iframe');
    expect(previewSource).toContain('PDF 미리보기');
    expect(previewSource).toContain('첨부 파일 원문을 불러올 수 없습니다.');
  });

  it('highlights attachment changes and previews the pending request document', () => {
    expect(detailSource).toContain('ATTACHMENT_CHANGE_KEYS');
    expect(detailSource).toContain('첨부파일 변경');
    expect(detailSource).toContain('수정사항');
    expect(detailSource).toContain('border border-amber-200 bg-amber-50');
    expect(detailSource).toContain('useRequestPayloadAsCurrent');
    expect(detailSource).toContain('resolveProjectRequestPayload');
    expect(detailSource).toContain('requestPayload?.contractDocument || record.project.contractDocument || null');
  });

  it('keeps CIC registration review read-only while improving scan hierarchy', () => {
    expect(detailSource).toContain('ReviewSection');
    expect(detailSource).toContain('ReviewFactGrid');
    expect(detailSource).toContain('sticky bottom-0');
    expect(detailSource).toContain('requestVersionDescription');
    expect(detailSource).not.toContain('ProjectEditorWizard');
    expect(detailSource).not.toContain('수정 저장');
  });
});
