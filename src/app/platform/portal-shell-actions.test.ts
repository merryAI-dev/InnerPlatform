import { describe, expect, it } from 'vitest';
import { buildPortalShellCommandItems, buildPortalShellNotificationItems } from './portal-shell-actions';

describe('portal shell actions', () => {
  it('builds open-palette work shortcuts, project switch items, and the admin escape hatch', () => {
    const items = buildPortalShellCommandItems({
      role: 'admin',
      currentPath: '/portal/budget',
      currentProject: { id: 'project-1', name: '2026 더큰 제주' },
      fundInputMode: 'BANK_STATEMENT',
      labEnabled: false,
      availableProjects: [
        { id: 'project-1', name: '2026 더큰 제주' },
        { id: 'project-2', name: '현대 모비스 CSV OI 컨설팅' },
      ],
    });

    expect(items.find((item) => item.id === 'portal:cashflow')).toMatchObject({
      label: '캐시플로우',
      to: '/portal/cashflow',
      category: '업무',
      kind: 'portal',
    });
    expect(items.some((item) => item.id === 'portal:weekly-expenses')).toBe(false);
    expect(items.some((item) => item.id === 'project:project-1')).toBe(true);
    expect(items.find((item) => item.id === 'project:project-2')?.to).toBe('/portal/budget');
    expect(items.some((item) => item.id === 'admin:home')).toBe(true);
  });

  it('filters direct commands through portal shell visibility', () => {
    const items = buildPortalShellCommandItems({
      role: 'pm',
      currentPath: '/portal',
      currentProject: null,
      fundInputMode: 'DIRECT_ENTRY',
      labEnabled: false,
      availableProjects: [],
    });

    expect(items.some((item) => item.to === '/portal/bank-statements')).toBe(false);
    expect(items.some((item) => item.id === 'portal:weekly-expenses')).toBe(false);
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
