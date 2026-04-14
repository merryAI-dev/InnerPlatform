import { describe, expect, it } from 'vitest';
import { buildPortalShellCommandItems, buildPortalShellNotificationItems } from './portal-shell-actions';

describe('portal shell actions', () => {
  it('builds project switch items only plus the admin escape hatch', () => {
    const items = buildPortalShellCommandItems({
      role: 'admin',
      currentPath: '/portal/budget',
      currentProject: { id: 'project-1', name: '2026 더큰 제주' },
      availableProjects: [
        { id: 'project-1', name: '2026 더큰 제주' },
        { id: 'project-2', name: '현대 모비스 CSV OI 컨설팅' },
      ],
    });

    expect(items.some((item) => item.kind === 'portal')).toBe(false);
    expect(items.some((item) => item.id === 'project:project-1')).toBe(true);
    expect(items.find((item) => item.id === 'project:project-2')?.to).toBe('/portal/budget');
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
