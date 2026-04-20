import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(resolve(import.meta.dirname, 'ProjectMigrationAuditPage.tsx'), 'utf8');
const controlBarSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditControlBar.tsx'), 'utf8');
const queueSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditQueueRail.tsx'), 'utf8');
const detailSource = readFileSync(resolve(import.meta.dirname, 'migration-audit/MigrationAuditDetailPanel.tsx'), 'utf8');
const compositeSource = [pageSource, controlBarSource, queueSource, detailSource].join('\n');

describe('ProjectMigrationAuditPage shell contract', () => {
  it('presents the migration review console as a search-first master detail approval surface', () => {
    expect(pageSource).toContain('data-testid="migration-review-queue"');
    expect(pageSource).toContain('data-testid="migration-review-dossier"');
    expect(compositeSource).toContain('data-testid="migration-review-search-bar"');
    expect(compositeSource).toContain('data-testid="migration-review-decision-footer"');
    expect(compositeSource).toContain('사업명으로 검색');
    expect(compositeSource).toContain('CIC 필터');
    expect(compositeSource).toContain('우리 사업으로 승인');
    expect(compositeSource).toContain('수정 요청 후 반려');
    expect(compositeSource).toContain('중복·폐기');
    expect(compositeSource).not.toContain('빠른 등록 시작');
    expect(compositeSource).not.toContain('기준 다시 적재');
    expect(compositeSource).not.toContain('운영 포커스');
  });
});
