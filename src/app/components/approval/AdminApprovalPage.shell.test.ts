import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AdminApprovalPage.tsx'), 'utf8');

describe('AdminApprovalPage shell contract', () => {
  it('leads with project registration review as a decision-ready approval surface', () => {
    expect(source).toContain('ProjectRequestApprovalSection');
    expect(source).toContain('사업 등록 심사');
    expect(source).toContain('대표 검토');
    expect(source).toContain('프로젝트 등록 승인부터 먼저 정리합니다');
  });
});
