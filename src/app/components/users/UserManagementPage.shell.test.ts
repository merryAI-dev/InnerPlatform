import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'UserManagementPage.tsx'), 'utf8');
const clientSource = readFileSync(resolve(import.meta.dirname, '../../lib/platform-bff-client.ts'), 'utf8');

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

  it('warns when canonical authority is saved but login claims are still pending', () => {
    expect(clientSource).toContain("claimsSyncStatus: 'SYNCED' | 'PENDING' | 'NOT_APPLICABLE'");
    expect(source).toContain("result.claimsSyncStatus === 'PENDING'");
    expect(source).toContain('권한 원본은 저장했지만 로그인 권한 동기화가 대기 중입니다. 잠시 후 다시 확인해 주세요.');
    expect(source).toContain('deepSyncAuthGovernanceUsersViaBff');
    expect(source).not.toContain('for (const row of targets)');
    expect(source).toContain('result.summary.pendingClaimsSync');
    expect(source).toContain('건은 로그인 권한 동기화가 대기 중입니다. 잠시 후 다시 확인해 주세요.');
  });

  it('does not expose raw transport errors during single or bulk authority sync', () => {
    expect(source).not.toContain('err?.message');
    expect(source).toContain('목록을 새로고침한 뒤 다시 시도해 주세요.');
    expect(source).toContain('일괄 정렬 요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
});
