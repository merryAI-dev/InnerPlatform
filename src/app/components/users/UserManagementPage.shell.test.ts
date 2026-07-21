import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'UserManagementPage.tsx'), 'utf8');

describe('UserManagementPage permission dashboard', () => {
  it('shows the complete member permission contract for admin cross-checking', () => {
    expect(source).toContain('data-testid="member-permission-dashboard"');
    expect(source).toContain('전체 멤버 권한 대시보드');
    expect(source).toContain('프로젝트 접근');
    expect(source).toContain('지정 조직장');
    expect(source).toContain('label="지정 조직장"');
    expect(source).toContain('>조직장</Badge>');
    expect(source).toContain('결산·재오픈 요청');
    expect(source).toContain('등록 승인');
    expect(source).toContain('재오픈 승인·반려');
    expect(source).toContain('permission?.canRequestCashflowClose');
    expect(source).toContain('permission?.canApproveProjectRegistration');
    expect(source).toContain('permission?.canDecideCashflowReopen');
  });
});
