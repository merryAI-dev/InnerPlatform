import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectRequestApprovalPage.tsx'), 'utf8');

describe('ProjectRequestApprovalPage shell contract', () => {
  it('delegates legacy request approval entry points to the unified project review console', () => {
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('ProjectRequestApprovalSection');
    expect(source).toContain('ProjectRequestApprovalPage');
    expect(source).toContain('embedded={compact}');
    expect(source).not.toContain('AI 계약 분석');
    expect(source).not.toContain('계약 원문 / AI 추출 비교');
  });
});
