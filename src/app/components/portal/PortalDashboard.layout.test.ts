import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const portalDashboardSource = readFileSync(
  resolve(import.meta.dirname, 'PortalDashboard.tsx'),
  'utf8',
);

describe('PortalDashboard layout compaction', () => {
  it('keeps project detail and weekly status inside one unified slab', () => {
    expect(portalDashboardSource).toContain('프로젝트 상세');
    expect(portalDashboardSource).toContain('이번 주 작업 상태');
    expect(portalDashboardSource).toContain('최근 Projection 수정');
    expect(portalDashboardSource).toContain('items-stretch gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]');
  });

  it('drops the separate operating shortcuts card to keep the page compact', () => {
    expect(portalDashboardSource).not.toContain('운영 바로가기');
    expect(portalDashboardSource).not.toContain('이번 주 바로 작업');
    expect(portalDashboardSource).not.toContain('프로젝트 설정');
    expect(portalDashboardSource).not.toContain('사업비 입력 열기');
  });

  it('drops explanatory paragraph copy from the hero slab', () => {
    expect(portalDashboardSource).not.toContain('발주기관, 정산 기준, 예산 흐름과 현재 작업 상태를 한 화면에서 확인합니다.');
  });

  it('moves the finance summary into the hero slab under the project title', () => {
    expect(portalDashboardSource).toContain('md:grid-cols-2 xl:grid-cols-4');
    expect(portalDashboardSource).not.toContain('CardTitle className="text-[13px] text-slate-900">자금 요약');
  });

  it('absorbs submissions into the dashboard and drops duplicate submission blocks', () => {
    expect(portalDashboardSource).toContain('내 제출 현황');
    expect(portalDashboardSource).toContain('제출 상태를 한 번에 확인합니다.');
    expect(portalDashboardSource).not.toContain('인력변경 신청');
    expect(portalDashboardSource).not.toContain('사업비 입력(주간) 작성/제출');
  });

  it('surfaces payroll memo-review attention directly on the dashboard', () => {
    expect(portalDashboardSource).toContain('인건비 적요 검토');
    expect(portalDashboardSource).toContain('PM 1차 검토 필요');
    expect(portalDashboardSource).toContain('인건비 검토 열기');
  });
});
