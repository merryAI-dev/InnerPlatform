import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'PortalSubmissionsPage.tsx'), 'utf8');

describe('PortalSubmissionsPage weekly history', () => {
  it('keeps weekly status as read-only history and delegates final authority to monthly close', () => {
    expect(source).toContain('현금흐름 승인');
    expect(source).toContain('주차별 입력 현황은 조회만 가능하며, 최종 확정과 수정 잠금은 프로젝트별 월 결산에서 처리합니다.');
    expect(source).toContain('기존 제출 이력');
    expect(source).toContain('기존 결산 이력');
    expect(source).not.toContain('useCashflowEditLease');
    expect(source).not.toContain('EditLeaseDialogs');
    expect(source).not.toContain('수동 보정');
    expect(source).not.toContain('주간 제출 상태를 변경할까요?');
    expect(source).not.toContain('작성완료');
    expect(source).not.toContain('결산완료');
    expect(source).not.toContain('마감 {weekDeadline}');
  });
});
