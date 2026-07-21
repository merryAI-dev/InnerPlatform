import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'ProjectDetailPage.tsx'), 'utf8');

describe('ProjectDetailPage shell contract', () => {
  it('shows a pending PM change request without replacing the approved project master values', () => {
    expect(source).toContain('usePendingProjectChangeRequests');
    expect(source).toContain('usePendingProjectChangeRequests(pendingProjectIds)');
    expect(source).toContain('pendingProjectChangeRequest');
    expect(source).toContain('수정 중');
    expect(source).toContain('describeProjectRequestVersion');
    expect(source).toContain('승인 전까지 이 화면은 현재 확정된 원장 값을 보여줍니다.');
  });

  it('shows the automatically provisioned project management folder when available', () => {
    expect(source).toContain('project.evidenceDriveRootFolderLink');
    expect(source).toContain('사업관리 폴더');
    expect(source).toContain('폴더 열기');
  });

  it('shows the confirmed groupware registration name in the current project detail', () => {
    expect(source).toContain('>그룹웨어 등록명</span>');
    expect(source).toContain("project.groupwareName || '-'");
  });
});
