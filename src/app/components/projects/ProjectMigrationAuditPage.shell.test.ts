import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'ProjectMigrationAuditPage.tsx'), 'utf8');
const controlBarSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditControlBar.tsx'), 'utf8');
const queueSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditQueueRail.tsx'), 'utf8');
const detailSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditDetailPanel.tsx'), 'utf8');
const compositeSource = [pageSource, controlBarSource, queueSource, detailSource].join('\n');

describe('ProjectMigrationAuditPage shell contract', () => {
  it('presents the page as a PM registration executive approval console', () => {
    expect(pageSource).toContain('data-testid="migration-review-queue"');
    expect(pageSource).toContain('data-testid="migration-review-dossier"');
    expect(compositeSource).toContain('data-testid="migration-review-search-bar"');
    expect(compositeSource).toContain('data-testid="migration-review-decision-footer"');
    expect(compositeSource).toContain('CIC 필터');
    expect(compositeSource).toContain('상태 필터');
    expect(compositeSource).toContain('h-14');
    expect(compositeSource).toContain('border-2 border-slate-300');
    expect(compositeSource).toContain('승인');
    expect(compositeSource).toContain('수정 요청 후 반려');
    expect(compositeSource).toContain('중복·폐기');
    expect(compositeSource).toContain('PM 등록 프로젝트 심사');
    expect(compositeSource).toContain('PM이 포털에서 입력한 내용을 그대로');
    expect(compositeSource).toContain('기존 등록 프로젝트는 읽기 전용 참고 화면입니다. 별도 승인 액션은 보여주지 않습니다.');
    expect(compositeSource).toContain('읽기 전용');
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
});
