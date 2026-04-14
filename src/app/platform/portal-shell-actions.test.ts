import { describe, expect, it } from 'vitest';
import { buildPortalShellCommandItems, buildPortalShellNotificationItems } from './portal-shell-actions';

describe('portal shell actions', () => {
  it('builds search commands for core portal work and current project', () => {
    const items = buildPortalShellCommandItems({
      role: 'admin',
      currentProject: { id: 'project-1', name: '2026 더큰 제주' },
      assignedProjects: [
        { id: 'project-1', name: '2026 더큰 제주' },
        { id: 'project-2', name: '현대 모비스 CSV OI 컨설팅' },
      ],
      topNavItems: [
        { to: '/portal', label: '내 사업 현황' },
        { to: '/portal/submissions', label: '내 제출 현황' },
        { to: '/portal/cashflow', label: '캐시플로(주간)' },
      ],
    });

    expect(items.some((item) => item.id === 'portal:/portal/cashflow')).toBe(true);
    expect(items.some((item) => item.id === 'project:project-1')).toBe(true);
    expect(items.some((item) => item.id === 'project:project-2' && item.projectId === 'project-2')).toBe(true);
    expect(items.some((item) => item.id === 'admin:home')).toBe(true);
  });

  it('only surfaces non-zero notifications and keeps links actionable', () => {
    const items = buildPortalShellNotificationItems({
      pendingChanges: 2,
      hrAlertCount: 0,
      payrollPendingCount: 1,
    });

    expect(items).toEqual([
      {
        id: 'changes',
        label: '인력변경/공지 확인',
        description: '인력변경 요청 2건',
        to: '/portal/change-requests',
      },
      {
        id: 'payroll',
        label: '인건비 확인',
        description: '확인 필요한 지급/월마감 1건',
        to: '/portal/payroll',
      },
    ]);
  });
});
