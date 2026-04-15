import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectRequestApprovalPage.tsx'), 'utf8');

describe('ProjectRequestApprovalPage shell contract', () => {
  it('renders the approval surface as an inbox/detail decision console', () => {
    expect(source).toContain('data-testid="project-request-inbox"');
    expect(source).toContain('data-testid="project-request-detail"');
    expect(source).toContain('data-testid="project-request-decision-rail"');
    expect(source).toContain('data-testid="project-request-risk-board"');
    expect(source).toContain('data-testid="project-request-status-strip"');
    expect(source).toContain('data-testid="project-request-review-summary"');
    expect(source).toContain('data-testid="project-request-review-analysis"');
    expect(source).toContain('data-testid="project-request-review-facts"');
    expect(source).toContain('data-testid="project-request-review-checklist"');
    expect(source).toContain('data-testid="project-request-review-history"');
    expect(source).toContain('승인 결정');
    expect(source).toContain('핵심 리스크');
    expect(source).toContain('검토 메모');
    expect(source).toContain('대기함');
    expect(source).toContain('결정 패널');
    expect(source).toContain('리뷰 요약');
    expect(source).toContain('AI 계약 분석');
    expect(source).toContain('핵심 재무/정산');
    expect(source).toContain('승인 체크리스트');
    expect(source).toContain('검토 이력');
    expect(source).toContain('대기 중인 요청');
    expect(source).toContain('처리 완료 이력');
    expect(source).not.toContain('flat field dump');
  });
});
