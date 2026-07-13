import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editLeaseHolderMessage } from './EditLeaseDialogs';

const source = readFileSync(new URL('./EditLeaseDialogs.tsx', import.meta.url), 'utf8');

describe('EditLeaseDialogs', () => {
  it('uses the approved holder wording for another user and another tab', () => {
    expect(editLeaseHolderMessage({
      holderDisplayName: '김메리',
      sameActor: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
    })).toBe('김메리님이 이 프로젝트를 수정 중입니다');
    expect(editLeaseHolderMessage({
      holderDisplayName: '김메리',
      sameActor: true,
      expiresAt: '2026-07-10T00:30:00.000Z',
    })).toBe('현재 계정의 다른 탭에서 수정 중입니다');
  });

  it('keeps the exact timeout copy and explicit actions in accessible alert dialogs', () => {
    expect(source).toContain('수정 세션이 종료되었습니다');
    expect(source).toContain('30분이 지나 선점만 해제되었습니다. 입력 내용과 첨부파일은 임시저장본에 유지됩니다.');
    expect(source).toContain('읽기 모드로 보기');
    expect(source).toContain('다시 수정하기');
    expect(source).toContain('30분 연장');
    expect(source).toContain('<AlertDialogTitle>');
    expect(source).toContain('<AlertDialogDescription>');
    expect(source).toContain('<AlertDialogAction');
    expect(source).toContain('<AlertDialogCancel');
  });
});
