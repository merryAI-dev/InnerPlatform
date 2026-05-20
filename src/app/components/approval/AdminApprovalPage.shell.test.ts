import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AdminApprovalPage.tsx'), 'utf8');

describe('AdminApprovalPage shell contract', () => {
  it('leads with project registration review as a decision-ready approval surface', () => {
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('<ProjectMigrationAuditPage embedded reviewScope="pending" />');
    expect(source).toContain('pendingProjectReviews');
    expect(source).toContain('프로젝트 등록 검토');
    expect(source).toContain('대표 검토');
    expect(source).toContain('프로젝트 등록 요청부터 먼저 정리합니다');
    expect(source).not.toContain('ProjectRequestApprovalSection');
  });
});
