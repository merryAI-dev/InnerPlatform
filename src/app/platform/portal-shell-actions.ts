export interface PortalShellNavItem {
  to: string;
  label: string;
}

export interface PortalShellProjectItem {
  id: string;
  name: string;
}

export interface PortalShellCommandItem {
  id: string;
  label: string;
  description: string;
  category: '업무' | '사업' | '관리';
  kind: 'portal' | 'admin';
  to: string;
  keywords: string[];
}

export interface PortalShellNotificationItem {
  id: string;
  label: string;
  description: string;
  to: string;
}

export function buildPortalShellCommandItems(input: {
  role: string | null | undefined;
  currentProject?: PortalShellProjectItem | null;
  topNavItems: PortalShellNavItem[];
}): PortalShellCommandItem[] {
  const navItems = input.topNavItems.map((item) => ({
    id: `portal:${item.to}`,
    label: item.label.replace('(주간)', ''),
    description: `${item.label.replace('(주간)', '')} 화면으로 이동`,
    category: '업무' as const,
    kind: 'portal' as const,
    to: item.to,
    keywords: [item.label, item.to],
  }));

  const projectItems = input.currentProject ? [{
    id: `project:${input.currentProject.id}`,
    label: input.currentProject.name,
    description: '현재 선택된 사업 기준으로 작업 화면 열기',
    category: '사업' as const,
    kind: 'portal' as const,
    to: '/portal',
    keywords: [input.currentProject.name, input.currentProject.id, '현재 사업'],
  }] : [];

  const adminItems = String(input.role || '').toLowerCase() === 'admin' || String(input.role || '').toLowerCase() === 'finance'
    ? [{
      id: 'admin:home',
      label: '관리자 공간',
      description: '전사 운영 화면으로 이동',
      category: '관리' as const,
      kind: 'admin' as const,
      to: '/',
      keywords: ['admin', '관리자', '대시보드'],
    }]
    : [];

  return [...navItems, ...projectItems, ...adminItems];
}

export function buildPortalShellNotificationItems(input: {
  pendingChanges: number;
  hrAlertCount: number;
  payrollPendingCount: number;
}): PortalShellNotificationItem[] {
  const items: PortalShellNotificationItem[] = [];
  const changeAndNoticeCount = input.pendingChanges + input.hrAlertCount;

  if (changeAndNoticeCount > 0) {
    items.push({
      id: 'changes',
      label: '인력변경/공지 확인',
      description: input.pendingChanges > 0
        ? `인력변경 요청 ${input.pendingChanges}건`
        : `미확인 공지 ${input.hrAlertCount}건`,
      to: '/portal/change-requests',
    });
  }

  if (input.payrollPendingCount > 0) {
    items.push({
      id: 'payroll',
      label: '인건비 확인',
      description: `확인 필요한 지급/월마감 ${input.payrollPendingCount}건`,
      to: '/portal/payroll',
    });
  }

  return items;
}
